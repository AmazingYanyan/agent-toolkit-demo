#!/usr/bin/env python3
"""必备条款覆盖检查（演示用，无第三方依赖、无网络访问、无副作用）。

输入：已识别到的条款类别（逗号分隔）
输出：缺项清单与覆盖率。模型只消费 JSON，不读取本文件源码。
"""

import argparse
import json
import sys

CATALOG = {
    "party": "主体信息（甲方、乙方、统一社会信用代码）",
    "payment": "付款节点（比例、时点、条件）",
    "breach": "违约条款（触发条件、责任方式）",
    "effective": "生效条件（签署、盖章、审批）",
    "guarantee": "担保条款（保证方式、保证范围、保证期间）",
    "dispute": "争议解决（机构、适用法律）",
}

BASE_REQUIRED = ["party", "payment", "breach", "effective", "dispute"]

REQUIRED_BY_TYPE = {
    "purchase": BASE_REQUIRED + ["guarantee"],
    "service": BASE_REQUIRED,
    "lease": BASE_REQUIRED + ["guarantee"],
    "other": BASE_REQUIRED,
}


def build_parser():
    p = argparse.ArgumentParser(description="合同必备条款覆盖检查（演示用）")
    p.add_argument("--present", required=True, help="已识别条款类别，逗号分隔")
    p.add_argument("--contract-type", dest="contract_type", default="other")
    return p


def main():
    args = build_parser().parse_args()
    present = [x.strip() for x in str(args.present).split(",") if x.strip()]

    unknown = [x for x in present if x not in CATALOG]
    valid = [x for x in present if x in CATALOG]

    required = REQUIRED_BY_TYPE.get(args.contract_type, BASE_REQUIRED)
    missing = [x for x in required if x not in valid]

    coverage = round(len([x for x in required if x in valid]) / len(required), 4) if required else 0

    print(json.dumps({
        "contract_type": args.contract_type,
        "present": [{"code": x, "label": CATALOG[x]} for x in valid],
        "unknown_codes": unknown,
        "required_by_type": [{"code": x, "label": CATALOG[x]} for x in required],
        "missing": [{"code": x, "label": CATALOG[x]} for x in missing],
        "coverage_rate": coverage,
        "complete": not missing,
        "note": "覆盖率只反映条款类别是否出现，不反映条款内容是否充分",
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        sys.exit(1)
