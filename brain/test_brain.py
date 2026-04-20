"""
快速測試：不需要啟動 server，直接呼叫 process()
執行：python test_brain.py
"""
import json
from schemas import STTInput
from brain import process

TEST_CASES = [
    # 標準案例
    "阿公今天傷口發紅，pain scale 4分，PRN 給一顆 Voren，BP 140/90",
    # 台語夾雜
    "病人講伊頭殼痛，BT 38.5，HR 92，給普拿疼 500mg PO",
    # 高劑量警示測試
    "病患主訴胸悶，BP 185/110，SpO2 94%，給 Acetaminophen 5000mg PO",
    # 多種藥物
    "傷口換藥完成，滲液少量，pain scale 2，給 Aspirin 100mg QD 及 Amlodipine 5mg QD",
]

if __name__ == "__main__":
    for i, text in enumerate(TEST_CASES, 1):
        print(f"\n{'='*60}")
        print(f"測試 {i}：{text}")
        print("─" * 60)
        try:
            result = process(STTInput(raw_text=text))
            print(json.dumps(result.model_dump(), ensure_ascii=False, indent=2))
        except Exception as e:
            print(f"❌ 錯誤：{e}")
