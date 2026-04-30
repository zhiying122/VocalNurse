"""
brain/test_records.py — 後端 records.py 屬性測試 + 單元測試

使用 pytest + hypothesis
每個屬性測試至少 100 次迭代
使用 tmp_path 隔離測試資料，不污染真實 records.json / patients.json
"""
import json
import os
import re
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from unittest.mock import patch

import pytest
from hypothesis import given, settings, assume, HealthCheck
from hypothesis import strategies as st

# ── 被測模組 ──
import records
import patients as _patients_mod


# ── Hypothesis Strategies ──

soap_strategy = st.fixed_dictionaries({
    "subjective": st.text(min_size=1, max_size=200),
    "objective": st.text(min_size=1, max_size=200),
    "assessment": st.text(min_size=1, max_size=200),
    "plan": st.text(min_size=1, max_size=200),
})

medication_strategy = st.fixed_dictionaries({
    "name": st.text(min_size=1, max_size=50),
    "dose": st.one_of(st.none(), st.text(min_size=1, max_size=10)),
    "unit": st.one_of(st.none(), st.from_regex(r"^(mg|ml|g|顆|cc)$")),
    "route": st.one_of(st.none(), st.from_regex(r"^(PO|IV|IM|SC|PRN)$")),
    "raw": st.text(min_size=1, max_size=100),
})

medications_strategy = st.lists(medication_strategy, min_size=0, max_size=5)

pain_scale_strategy = st.one_of(st.none(), st.integers(min_value=0, max_value=10))

warnings_strategy = st.lists(st.text(min_size=1, max_size=50), min_size=0, max_size=3)

raw_text_strategy = st.text(min_size=0, max_size=500)

nurse_id_strategy = st.from_regex(r"^N[0-9]{3}$", fullmatch=True)

nurse_name_strategy = st.text(
    alphabet=st.characters(whitelist_categories=("L",)),
    min_size=1,
    max_size=10,
)

shift_strategy = st.sampled_from(["日班", "小夜班", "大夜班"])


# ── Constants ──

FAKE_PATIENT_ID = "P_TEST1"
FAKE_PATIENT = {
    "id": FAKE_PATIENT_ID,
    "name": "測試病患",
    "bed": "1A-01",
    "mrn": "MTEST0001",
    "dx": "測試診斷",
    "age": 30,
    "allergies": [],
}


# ── Context manager for test isolation ──

@contextmanager
def isolated_records():
    """
    Context manager that redirects records.RECORDS_FILE to a temp file
    and mocks patients.list_patients() to return FAKE_PATIENT.
    Cleans up after the block.
    """
    fd, tmp_file = tempfile.mkstemp(suffix=".json")
    os.close(fd)
    # Remove the file so tests can verify auto-creation
    os.remove(tmp_file)

    original_records_file = records.RECORDS_FILE
    original_list_patients = _patients_mod.list_patients

    records.RECORDS_FILE = tmp_file
    _patients_mod.list_patients = lambda: [FAKE_PATIENT]

    try:
        yield tmp_file
    finally:
        records.RECORDS_FILE = original_records_file
        _patients_mod.list_patients = original_list_patients
        if os.path.exists(tmp_file):
            os.remove(tmp_file)


# ── Fixture for unit tests ──

@pytest.fixture(autouse=True)
def isolate_records(tmp_path, monkeypatch):
    """
    Fixture for unit tests (non-hypothesis).
    Each test uses an independent records.json and mocked patients.
    """
    records_file = str(tmp_path / "records.json")
    monkeypatch.setattr(records, "RECORDS_FILE", records_file)
    monkeypatch.setattr(
        _patients_mod,
        "list_patients",
        lambda: [FAKE_PATIENT],
    )
    return records_file


# ═══════════════════════════════════════════════════════════
# Property 1: 紀錄儲存與查詢的往返一致性 (Round-trip)
# **Validates: Requirements 1.1, 1.2, 1.3, 3.2, 9.3**
# ═══════════════════════════════════════════════════════════

class TestProperty1RoundTrip:
    """
    Feature: shared-nursing-records, Property 1: 紀錄儲存與查詢的往返一致性

    For any valid SOAP record input, add_record() then get_patient_records()
    returns a record with all original fields intact plus generated id and created_at.

    **Validates: Requirements 1.1, 1.2, 1.3, 3.2, 9.3**
    """

    @given(
        soap=soap_strategy,
        medications=medications_strategy,
        pain_scale=pain_scale_strategy,
        warnings=warnings_strategy,
        raw_text=raw_text_strategy,
        nurse_id=nurse_id_strategy,
        nurse_name=nurse_name_strategy,
        shift=shift_strategy,
    )
    @settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_round_trip_consistency(
        self,
        isolate_records,
        soap,
        medications,
        pain_scale,
        warnings,
        raw_text,
        nurse_id,
        nurse_name,
        shift,
    ):
        with isolated_records():
            saved = records.add_record(
                patient_id=FAKE_PATIENT_ID,
                soap=soap,
                medications=medications,
                pain_scale=pain_scale,
                warnings=warnings,
                raw_text=raw_text,
                nurse_id=nurse_id,
                nurse_name=nurse_name,
                shift=shift,
            )

            # Verify returned record has all original fields
            assert saved["patient_id"] == FAKE_PATIENT_ID
            assert saved["soap"] == soap
            assert saved["medications"] == medications
            assert saved["pain_scale"] == pain_scale
            assert saved["warnings"] == warnings
            assert saved["raw_text"] == raw_text
            assert saved["nurse_id"] == nurse_id
            assert saved["nurse_name"] == nurse_name
            assert saved["shift"] == shift

            # Verify generated fields exist
            assert "id" in saved
            assert "created_at" in saved

            # Now query and verify round-trip
            fetched = records.get_patient_records(FAKE_PATIENT_ID)
            assert len(fetched) == 1
            record = fetched[0]

            assert record["patient_id"] == FAKE_PATIENT_ID
            assert record["soap"] == soap
            assert record["medications"] == medications
            assert record["pain_scale"] == pain_scale
            assert record["warnings"] == warnings
            assert record["raw_text"] == raw_text
            assert record["nurse_id"] == nurse_id
            assert record["nurse_name"] == nurse_name
            assert record["shift"] == shift
            assert record["id"] == saved["id"]
            assert record["created_at"] == saved["created_at"]


# ═══════════════════════════════════════════════════════════
# Property 2: 病患紀錄查詢按時間降序排列且包含所有護理師的紀錄
# **Validates: Requirements 2.1, 2.2**
# ═══════════════════════════════════════════════════════════

class TestProperty2DescendingOrder:
    """
    Feature: shared-nursing-records, Property 2: 病患紀錄查詢按時間降序排列且包含所有護理師的紀錄

    For any set of records from different nurses for the same patient,
    get_patient_records() returns records sorted by created_at descending
    and includes all nurses' records.

    **Validates: Requirements 2.1, 2.2**
    """

    @given(
        nurse_ids=st.lists(nurse_id_strategy, min_size=2, max_size=6),
        nurse_names=st.lists(nurse_name_strategy, min_size=2, max_size=6),
        shifts=st.lists(shift_strategy, min_size=2, max_size=6),
    )
    @settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_descending_timestamp_and_all_nurses(
        self,
        isolate_records,
        nurse_ids,
        nurse_names,
        shifts,
    ):
        count = min(len(nurse_ids), len(nurse_names), len(shifts))
        assume(count >= 2)

        with isolated_records():
            saved_records = []
            for i in range(count):
                saved = records.add_record(
                    patient_id=FAKE_PATIENT_ID,
                    soap={
                        "subjective": f"S{i}",
                        "objective": f"O{i}",
                        "assessment": f"A{i}",
                        "plan": f"P{i}",
                    },
                    medications=[],
                    pain_scale=i % 11,
                    warnings=[],
                    raw_text=f"raw {i}",
                    nurse_id=nurse_ids[i],
                    nurse_name=nurse_names[i],
                    shift=shifts[i],
                )
                saved_records.append(saved)

            fetched = records.get_patient_records(FAKE_PATIENT_ID)

            # All records should be returned
            assert len(fetched) == count

            # Records should be sorted by created_at descending
            timestamps = [r["created_at"] for r in fetched]
            assert timestamps == sorted(timestamps, reverse=True)

            # All nurse_ids from saved records should appear in fetched
            saved_nurse_ids = {r["nurse_id"] for r in saved_records}
            fetched_nurse_ids = {r["nurse_id"] for r in fetched}
            assert saved_nurse_ids == fetched_nurse_ids


# ═══════════════════════════════════════════════════════════
# Property 3: 日期篩選只回傳符合日期的紀錄
# **Validates: Requirements 3.3**
# ═══════════════════════════════════════════════════════════

class TestProperty3DateFilter:
    """
    Feature: shared-nursing-records, Property 3: 日期篩選只回傳符合日期的紀錄

    For any set of records with various dates and a filter date,
    list_records(date_filter=date) returns only records matching that date,
    and all matching records are included.

    **Validates: Requirements 3.3**
    """

    @given(
        dates=st.lists(
            st.dates(
                min_value=datetime(2024, 1, 1).date(),
                max_value=datetime(2025, 12, 31).date(),
            ),
            min_size=2,
            max_size=8,
        ),
        filter_date=st.dates(
            min_value=datetime(2024, 1, 1).date(),
            max_value=datetime(2025, 12, 31).date(),
        ),
    )
    @settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_date_filter_correctness(
        self,
        isolate_records,
        dates,
        filter_date,
    ):
        with isolated_records() as tmp_file:
            # Directly write records with controlled created_at timestamps
            all_records = []
            for i, d in enumerate(dates):
                ts = datetime(
                    d.year, d.month, d.day, 10, 0, 0, tzinfo=timezone.utc
                ).isoformat()
                record = {
                    "id": f"R{i:06X}",
                    "patient_id": FAKE_PATIENT_ID,
                    "soap": {
                        "subjective": f"S{i}",
                        "objective": f"O{i}",
                        "assessment": f"A{i}",
                        "plan": f"P{i}",
                    },
                    "medications": [],
                    "pain_scale": None,
                    "warnings": [],
                    "raw_text": "",
                    "nurse_id": "N001",
                    "nurse_name": "測試",
                    "shift": "日班",
                    "created_at": ts,
                }
                all_records.append(record)

            # Write directly to the records file
            with open(tmp_file, "w", encoding="utf-8") as f:
                json.dump(all_records, f, ensure_ascii=False)

            filter_str = filter_date.isoformat()
            result = records.list_records(date_filter=filter_str)

            # Every returned record must match the filter date
            for r in result:
                assert r["created_at"][:10] == filter_str

            # All records matching the filter date must be included
            expected_count = sum(1 for d in dates if d.isoformat() == filter_str)
            assert len(result) == expected_count


# ═══════════════════════════════════════════════════════════
# Property 4: 不存在的病患 ID 產生錯誤
# **Validates: Requirements 1.5, 2.4**
# ═══════════════════════════════════════════════════════════

class TestProperty4NonexistentPatient:
    """
    Feature: shared-nursing-records, Property 4: 不存在的病患 ID 產生錯誤

    For any patient ID not in the patients store,
    add_record() and get_patient_records() raise appropriate errors.

    **Validates: Requirements 1.5, 2.4**
    """

    @given(
        patient_id=st.text(min_size=1, max_size=20).filter(lambda x: x != FAKE_PATIENT_ID),
    )
    @settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_add_record_nonexistent_patient(self, isolate_records, patient_id):
        with isolated_records():
            with pytest.raises(ValueError, match="病患不存在"):
                records.add_record(
                    patient_id=patient_id,
                    soap={
                        "subjective": "S",
                        "objective": "O",
                        "assessment": "A",
                        "plan": "P",
                    },
                    medications=[],
                    pain_scale=None,
                    warnings=[],
                    raw_text="",
                    nurse_id="N001",
                    nurse_name="測試",
                    shift="日班",
                )

    @given(
        patient_id=st.text(min_size=1, max_size=20).filter(lambda x: x != FAKE_PATIENT_ID),
    )
    @settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_get_patient_records_nonexistent_patient(self, isolate_records, patient_id):
        with isolated_records():
            with pytest.raises(ValueError, match="病患不存在"):
                records.get_patient_records(patient_id)


# ═══════════════════════════════════════════════════════════
# Unit Tests: Edge Cases (Task 9.5)
# ═══════════════════════════════════════════════════════════

class TestEdgeCases:
    """Unit tests for edge cases in records.py"""

    def test_auto_create_records_json(self, isolate_records):
        """
        Test records.json auto-creation when file does not exist.
        Requirement 1.4
        """
        # Ensure the file does not exist
        if os.path.exists(isolate_records):
            os.remove(isolate_records)

        assert not os.path.exists(isolate_records)

        # add_record should create the file
        records.add_record(
            patient_id=FAKE_PATIENT_ID,
            soap={
                "subjective": "S",
                "objective": "O",
                "assessment": "A",
                "plan": "P",
            },
            medications=[],
            pain_scale=None,
            warnings=[],
            raw_text="",
            nurse_id="N001",
            nurse_name="測試",
            shift="日班",
        )

        assert os.path.exists(isolate_records)
        with open(isolate_records, "r", encoding="utf-8") as f:
            data = json.load(f)
        assert isinstance(data, list)
        assert len(data) == 1

    def test_empty_records_for_patient(self, isolate_records):
        """
        Test empty records for a patient returns empty list.
        Requirement 2.3
        """
        result = records.get_patient_records(FAKE_PATIENT_ID)
        assert result == []

    def test_record_id_format(self, isolate_records):
        """
        Test Record ID format matches R + 6-char hex pattern.
        Requirement 1.1
        """
        saved = records.add_record(
            patient_id=FAKE_PATIENT_ID,
            soap={
                "subjective": "S",
                "objective": "O",
                "assessment": "A",
                "plan": "P",
            },
            medications=[],
            pain_scale=5,
            warnings=[],
            raw_text="test",
            nurse_id="N001",
            nurse_name="測試",
            shift="日班",
        )

        record_id = saved["id"]
        # Must match R + exactly 6 hex characters (uppercase)
        assert re.fullmatch(r"R[0-9A-F]{6}", record_id), (
            f"Record ID '{record_id}' does not match R + 6-char hex pattern"
        )

    def test_duplicate_record_detection(self, isolate_records):
        """
        Test duplicate record detection (patient_id + created_at + nurse_id).
        The second call with the same timestamp should return the existing record
        instead of creating a new one.
        """
        # Patch datetime.now to return a fixed time for both calls
        fixed_time = datetime(2025, 6, 15, 10, 0, 0, tzinfo=timezone.utc)

        with patch("records.datetime") as mock_dt:
            mock_dt.now.return_value = fixed_time
            mock_dt.side_effect = lambda *a, **kw: datetime(*a, **kw)

            first = records.add_record(
                patient_id=FAKE_PATIENT_ID,
                soap={
                    "subjective": "S",
                    "objective": "O",
                    "assessment": "A",
                    "plan": "P",
                },
                medications=[],
                pain_scale=3,
                warnings=[],
                raw_text="test",
                nurse_id="N001",
                nurse_name="測試",
                shift="日班",
            )

            second = records.add_record(
                patient_id=FAKE_PATIENT_ID,
                soap={
                    "subjective": "S2",
                    "objective": "O2",
                    "assessment": "A2",
                    "plan": "P2",
                },
                medications=[],
                pain_scale=5,
                warnings=[],
                raw_text="test2",
                nurse_id="N001",
                nurse_name="測試",
                shift="小夜班",
            )

        # The second call should return the first record (duplicate detected)
        assert first["id"] == second["id"]
        assert first["created_at"] == second["created_at"]

        # Only one record should exist in the store
        all_recs = records.get_patient_records(FAKE_PATIENT_ID)
        assert len(all_recs) == 1
