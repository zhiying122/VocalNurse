"""
病患資料管理（JSON 檔案儲存）
"""
import json
import os
import uuid

PATIENTS_FILE = os.path.join(os.path.dirname(__file__), "patients.json")


def _load() -> list[dict]:
    if os.path.exists(PATIENTS_FILE):
        with open(PATIENTS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


def _save(patients: list[dict]):
    with open(PATIENTS_FILE, "w", encoding="utf-8") as f:
        json.dump(patients, f, ensure_ascii=False, indent=2)


def list_patients() -> list[dict]:
    return _load()


def add_patient(name: str, bed: str, dx: str, age: int, allergies: list[str] = None) -> dict:
    patients = _load()
    patient = {
        "id": f"P{uuid.uuid4().hex[:6].upper()}",
        "name": name,
        "bed": bed,
        "mrn": f"M{uuid.uuid4().hex[:8].upper()}",
        "dx": dx,
        "age": age,
        "allergies": allergies or [],
    }
    patients.append(patient)
    _save(patients)
    return patient


def delete_patient(patient_id: str) -> bool:
    patients = _load()
    new_list = [p for p in patients if p["id"] != patient_id]
    if len(new_list) == len(patients):
        return False
    _save(new_list)
    return True
