# Phase 1 Frontend Smoke Test Report (R5 Formal Showcase Case)

**Date:** 2026-07-03
**Test Data:** R5 formal_end_to_end_acceptance (formal_feasible_suite)
**Status:** ✅ PASSED

## 1. Test Environment

| Item      | Value                                                         |
| --------- | ------------------------------------------------------------- |
| Backend   | `node server.js` on localhost:3000                            |
| Frontend  | `npm run dev` (Vite) on localhost:5173                        |
| Database  | `dev.db` (SQLite, populated via `scripts/load_r5_fixture.py`) |
| R5 Output | `payload_formal_end_to_end_acceptance_regression_r5.json`     |
| R5 Status | FEASIBLE, 1756 schedule entries, 61 classes                   |

## 2. A-02: Frontend & Export Minimum Verification

### A-02.1 ClassroomManagerView consumes formal showcase case ✅

- **URL:** `http://localhost:5173/classrooms`
- **Result:** Page loaded successfully with R5 timetable data
- **Classes displayed:** 61 classes (1年1班 through 6年11班)
- **Data source:** R5 formal payload via `scripts/load_r5_fixture.py` → `dev.db` → `/api/schedule`
- **Evidence:** Playwright navigation + snapshot confirmed class list and timetable rendering

### A-02.2 ExportHubView / export flow works ✅

- **URL:** `http://localhost:5173/export`
- **Result:** ExportHubView loaded with 61 classes
- **Export executed:** 教育部標準格式\_教師總表 (XLSX)
- **Download:** File successfully downloaded and preserved as `smoke_evidence/r5_export_xlsx.xlsx`
- **Evidence:** Export flow completed successfully and the downloaded artifact was archived into `smoke_evidence/`

## 3. V-09: Minimum Frontend / Export Verification

| Check                                                   | Status  | Evidence                                                    |
| ------------------------------------------------------- | ------- | ----------------------------------------------------------- |
| At least one formal showcase case readable in frontend  | ✅ PASS | `/classrooms` shows 61 classes with R5 timetable            |
| At least one formal showcase case successfully exported | ✅ PASS | XLSX export downloaded successfully                         |
| Data is from R5 formal payload (not random DB data)     | ✅ PASS | Data loaded via `scripts/load_r5_fixture.py` from R5 output |

## 4. Test Steps Executed

1. **Load R5 fixture:** `python scripts/load_r5_fixture.py`
   - Loaded 1756 schedule entries from R5 output
   - Built timetables for 61 classes
   - Backed up `dev.db` → `dev.db.r5-backup`
   - Updated all 61 classes in database

2. **Verify /classrooms:** Navigate to `http://localhost:5173/classrooms`
   - Page rendered with complete class list
   - Timetable data visible for all grades

3. **Verify /export:** Navigate to `http://localhost:5173/export`
   - ExportHubView showed 61 classes loaded
   - All 6 export options available

4. **Execute export flow:** Click first XLSX export button
   - File downloaded successfully and preserved as `smoke_evidence/r5_export_xlsx.xlsx`
   - No errors in console

## 5. Evidence Artifacts

| Artifact               | Path                                          | Description                             |
| ---------------------- | --------------------------------------------- | --------------------------------------- |
| /classrooms screenshot | `smoke_evidence/classrooms_r5.png`            | ClassroomManagerView with 61 R5 classes |
| /export screenshot     | `smoke_evidence/export_view.png`              | ExportHubView with 61 R5 classes        |
| Export download        | `smoke_evidence/r5_export_xlsx.xlsx`          | XLSX file from R5 export flow           |
| Evidence summary       | `smoke_evidence/r5_smoke_evidence_summary.md` | Full evidence chain summary             |

## 6. Conclusion

**A-02: ✅ COMPLETED** - Frontend and export minimum verification passed using R5 formal showcase case.

**V-09: ✅ COMPLETED** - Minimum frontend/export verification passed with formal payload data.

Both checks use the R5 `formal_end_to_end_acceptance` payload, not random DB data.
