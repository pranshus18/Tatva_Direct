import json
import logging
from typing import Any, Optional

from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_google_genai import ChatGoogleGenerativeAI

from agent.confirmations import handle_confirmation_gate
from agent.intents import Intent, classify_intent
from agent.memory import SessionMemory
from agent.tools.address_tools import build_address_tools
from agent.tools.cart_tools import build_cart_tools
from agent.tools.catalog_tools import build_catalog_tools
from agent.tools.order_tools import build_order_tools
from agent.tools.payment_tools import build_payment_tools
from agent.tools.support_rag_tool import build_support_tools
from config import get_settings
from integrations.tatva_api_client import TatvaApiClient
from rag.retriever import retrieve_support_context

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are Tatva voice commerce assistant for construction material buyers (service providers).

Rules:
- Use tools for ALL cart, order, payment, search, and address actions. Never invent order IDs or stock.
- Use answer_support_question only for FAQs, policies, refunds, and general help — not for transactions.
- Keep spoken responses short (1-3 sentences).
- Before place order, payment, or cancel: the system handles confirmation; do not skip it.
- If the user confirms (yes), pending actions are executed by the system — acknowledge results briefly.
"""


class VoiceOrchestrator:
    def __init__(self, token: str, memory: SessionMemory):
        self.client = TatvaApiClient(token)
        self.memory = memory
        self.settings = get_settings()
        self._order_helpers = build_order_tools(self.client, memory)
        self._payment_helpers = build_payment_tools(self.client, memory)

        def mem_set(key: str, val: Any):
            self.memory.set_context(key, val)

        tools = []
        tools.extend(build_catalog_tools(self.client))
        tools.extend(build_cart_tools(self.client, mem_set))
        tools.extend(self._order_helpers["tools"])
        tools.extend(self._payment_helpers["tools"])
        tools.extend(build_address_tools(self.client))
        tools.extend(build_support_tools())
        self.tools = tools
        self._executor: Optional[AgentExecutor] = None

    def _build_executor(self) -> AgentExecutor:
        if not self.settings.gemini_api_key:
            raise RuntimeError("GEMINI_API_KEY is not configured")

        llm = ChatGoogleGenerativeAI(
            model=self.settings.gemini_model,
            google_api_key=self.settings.gemini_api_key,
            temperature=0.2,
        )
        prompt = ChatPromptTemplate.from_messages(
            [
                ("system", SYSTEM_PROMPT),
                MessagesPlaceholder("chat_history"),
                ("human", "{input}"),
                MessagesPlaceholder("agent_scratchpad"),
            ]
        )
        agent = create_tool_calling_agent(llm, self.tools, prompt)
        return AgentExecutor(agent=agent, tools=self.tools, verbose=False, max_iterations=6)

    @property
    def executor(self) -> AgentExecutor:
        if self._executor is None:
            self._executor = self._build_executor()
        return self._executor

    async def _run_pending_confirm(self, pending: dict) -> str:
        ptype = pending.get("type")
        payload = pending.get("payload") or {}
        self.memory.set_pending_action(None)

        if ptype == "place_order":
            return await self._order_helpers["execute_place_order"](payload)
        if ptype == "cancel_order":
            return await self._order_helpers["execute_cancel_order"](payload)
        if ptype == "payment":
            oid = payload.get("order_id")
            return await self._payment_helpers["execute_online_payment"](oid)
        return "Unknown pending action."

    async def _reject_pending(self) -> str:
        self.memory.set_pending_action(None)
        return "Okay, I cancelled that action."

    async def handle_transcript(self, user_text: str) -> str:
        text = (user_text or "").strip()
        if not text:
            return "I didn't catch that. Please try again."

        pending = self.memory.get_pending_action()

        async def on_confirm(p: dict) -> str:
            return await self._run_pending_confirm(p)

        handled, reply = await handle_confirmation_gate(
            text,
            pending,
            on_confirm=on_confirm,
            on_reject=self._reject_pending,
        )
        if handled and reply:
            self.memory.append_message("user", text)
            self.memory.append_message("assistant", reply)
            return reply

        intent = classify_intent(text)
        if intent == Intent.SUPPORT and not pending:
            chunks = retrieve_support_context(text)
            if chunks and not self.settings.gemini_api_key:
                return chunks[0][:500]
            text = f"{text}\n\n[Use answer_support_question for policy/FAQ topics.]"

        history = []
        for msg in self.memory.get_messages()[-8:]:
            role = msg.get("role", "user")
            if role == "assistant":
                history.append(("ai", msg.get("content", "")))
            else:
                history.append(("human", msg.get("content", "")))

        try:
            result = await self.executor.ainvoke({"input": text, "chat_history": history})
            output = result.get("output") or "Done."
        except Exception as exc:
            logger.exception("Agent error: %s", exc)
            output = "Sorry, I had trouble processing that. Please try again."

        self.memory.append_message("user", text)
        self.memory.append_message("assistant", output)
        return output
