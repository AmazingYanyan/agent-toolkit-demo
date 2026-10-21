#!/usr/bin/env python3
"""输入数据完整性与合理性校验（演示用，无第三方依赖、无网络访问、无副作用）。

用途：在开始分析之前，先确认字段是否齐全、数值是否自相矛盾。
模型只消费标准输出的 JSON，不需要阅读本文件源码。
"""

import argparse
import json
import sys

FIELDS = [
    ("assets", "总资产"),
    ("liabilities", "总负债"),
    ("revenue_current", "本期营业收入"),
    ("revenue_prior", "上期营业收入"),
    ("ocf", "经营活动现金流量净额"),
]

REQUIRED = ["assets", "liabilities"]


def build_parser():
    p = argparse.ArgumentParser(description="校验财务输入数据（演示用）")
    p.add_argument("--assets", type=float)
    p.add_argument("--liabilities", type=float)
    p.add_argument("--revenue-current", dest="revenue_current", type=float)
    p.add_argument("--revenue-prior", dest="revenue_prior", type=float)
    p.add_argument("--ocf", type=float)
    return p


def main():
    args = build_parser().parse_args()
    values = {k: getattr(args, k) for k, _ in FIELDS}

    missing = [k for k, _ in FIELDS if values.get(k) is None]
    missing_required = [k for k in REQUIRED if values.get(k) is None]

    issues = []

    if values.get("assets") is not None and values["assets"] <= 0:
        issues.append({"code": "E_ASSETS", "message": "总资产必须大于 0", "severity": "error"})

    if (
        values.get("assets") is not None
        and values.get("liabilities") is not None
        and values["liabilities"] > values["assets"]
    ):
        issues.append({
            "code": "E_INSOLVENT",
            "message": "总负债大于总资产，所有者权益为负，需核实数据是否包含特殊事项",
            "severity": "error",
        })

    if values.get("assets") is not None and values.get("assets") < 10:
        issues.append({
            "code": "W_UNIT",
            "message": "总资产数值小于 10，疑似单位不是万元，请确认量级",
            "severity": "warning",
        })

    if values.get("revenue_prior") == 0:
        issues.append({
            "code": "W_PRIOR_ZERO",
            "message": "上期营业收入为 0，同比变动率无法计算",
            "severity": "warning",
        })

    complete = not missing_required
    print(json.dumps({
        "complete": complete,
        "missing": missing,
        "missing_required": missing_required,
        "issues": issues,
        "can_analyze": complete and not any(i["severity"] == "error" for i in issues),
        "note": "missing_required 非空时无法按标准方法完成分析，应直接向用户索取",
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        sys.exit(1)
