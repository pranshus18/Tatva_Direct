import json

from langchain_core.tools import tool

from rag.retriever import retrieve_support_context


def build_support_tools():
    @tool
    async def answer_support_question(question: str) -> str:
        """
        Answer FAQs, policies, returns, shipping, and product support using knowledge base only.
        Do not use for cart, orders, or payments.
        """
        chunks = retrieve_support_context(question, k=4)
        if not chunks:
            return "I don't have policy information loaded yet. Please contact support."
        return json.dumps({"sources": len(chunks), "context": chunks})

    return [answer_support_question]
