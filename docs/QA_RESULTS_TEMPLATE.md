# QA Results Template - Tatva Direct

Use this file for each QA cycle. Duplicate it as:

`QA_RESULTS_YYYY-MM-DD.md`

---

## 1) Test Run Metadata

- **Release / Build Version:**  
- **Environment:** (Local / Staging / Prod-like)  
- **Backend Commit:**  
- **Frontend Commit:**  
- **Database Snapshot / Migration State:**  
- **Tester Name:**  
- **Test Date:**  
- **Start Time:**  
- **End Time:**  

---

## 2) Pre-Run Checklist

- [ ] Backend server started successfully
- [ ] Frontend server started successfully
- [ ] Backend automated tests passed (`npm test`)
- [ ] Frontend automated tests passed (`npm test`)
- [ ] Required users available (admin, supplier, service provider)
- [ ] Supplier products and stock available
- [ ] Payment test configuration verified
- [ ] Latest migrations applied (including atomic cancel/restock)

Notes:

---

## 3) Scenario Execution Log

Status values: `PASS` / `FAIL` / `BLOCKED` / `NOT RUN`

| Scenario ID | Scenario Name | Status | Defect ID (if fail) | Evidence (Screenshot/Video path) | Notes |
|---|---|---|---|---|---|
| AUTH-01 | Valid login by role |  |  |  |  |
| AUTH-02 | Unauthorized route blocked |  |  |  |  |
| DISC-01 | Search by product name |  |  |  |  |
| DISC-02 | Category filter |  |  |  |  |
| DISC-03 | Empty query discovery list |  |  |  |  |
| CHK-01 | Create PO valid data |  |  |  |  |
| CHK-02 | Checkout validation for missing address |  |  |  |  |
| PAY-01 | Online payment success path |  |  |  |  |
| PAY-02 | Bank transfer fallback path |  |  |  |  |
| ORD-EDIT-01 | Edit unpaid pending/confirmed order |  |  |  |  |
| ORD-EDIT-02 | Edit paid/fulfilled order blocked |  |  |  |  |
| ORD-CAN-01 | Cancel unpaid pending/confirmed order |  |  |  |  |
| ORD-CAN-02 | Cancel paid/fulfilled order blocked |  |  |  |  |
| ORD-CAN-03 | Repeat cancel no duplicate restock |  |  |  |  |
| INV-01 | Cancel restock entry created once |  |  |  |  |
| INV-02 | Stock restored correctly |  |  |  |  |
| REV-01 | Rating blocked before delivered+paid |  |  |  |  |
| REV-02 | Rating submit + persistence |  |  |  |  |
| RET-01 | Return request valid flow |  |  |  |  |
| RET-02 | Return invalid quantity blocked |  |  |  |  |
| NOTIF-01 | Notifications appear/read flow |  |  |  |  |
| REG-01 | Vendor ranking regression check |  |  |  |  |
| REG-02 | Product management regression check |  |  |  |  |
| REG-03 | Admin view regression check |  |  |  |  |

---

## 4) Defect Tracker

Severity guide:
- **P1** = critical release blocker
- **P2** = major function broken
- **P3** = minor bug / UX issue
- **P4** = cosmetic / low impact

| Defect ID | Severity | Scenario ID | Summary | Steps to Reproduce | Expected | Actual | Screenshot/Video path | Owner | Status |
|---|---|---|---|---|---|---|---|---|---|
| BUG-001 |  |  |  |  |  |  |  |  | Open |

---

## 5) DB Verification Log (for cancellation/restock)

Record SQL checks and output summary:

- **Order checked (id/order_number):**  
- **Cancellation status verified:** Yes / No  
- **Restock movement count:**  
- **Duplicate restock prevented:** Yes / No  
- **Stock quantity before/after:**  

Notes:

---

## 6) Coverage Summary

- **Total scenarios:** 24  
- **Pass:**  
- **Fail:**  
- **Blocked:**  
- **Not Run:**  
- **Pass Rate (%):**  

---

## 7) Release Decision

- [ ] **GO** (ready to release)
- [ ] **NO-GO** (hold release)

**Decision rationale:**

-  
-  

---

## 8) Sign-off

- **QA Tester:**  
- **Tech Lead / Reviewer:**  
- **Sign-off Date:**  

