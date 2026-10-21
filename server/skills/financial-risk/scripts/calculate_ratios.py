#!/usr/bin/env python3
"""确定性财务指标计算脚本（演示用，无第三方依赖、无网络访问、无副作用）。

只做三件事：按固定口径算指标、按固定阈值判定、输出 JSON。
模型不需要阅读本文件源码，只消费标准输出。
"""

import argparse
import json
import sys


def build_parser():
    p = argparse.ArgumentParser(description="计算财务指标与阈值判定（演示用）")
    p.add_argument("--assets", type=float, help="本期总资产（万元）")
    p.add_argument("--liabilities", type=float, help="本期总负债（万元）")
    p.add_argument("--revenue-current", dest="revenue_current", type=float, help="本期营业收入（万元）")
    p.add_argument("--revenue-prior", dest="revenue_prior", type=float, help="上期营业收入（万元）")
    p.add_argument("--ocf", type=float, help="本期经营活动现金流量净额（万元）")
    return p


def main():
    args = build_parser().parse_args()
    out = {"computed": {}, "thresholds": [], "notes": []}

    # ---- 资产负债率 ----
    if args.assets is None or args.liabilities is None:
        out["notes"].append("缺少总资产或总负债，未计算资产负债率")
    elif args.assets <= 0:
        out["notes"].append("总资产必须大于 0，未计算资产负债率")
    else:
        ratio = args.liabilities / args.assets
        out["computed"]["debt_asset_ratio"] = {
            "value": round(ratio, 4),
            "percent": round(ratio * 100, 2),
            "formula": f"{args.liabilities} / {args.assets}",
        }
        if ratio > 0.70:
            out["thresholds"].append({
                "id": "R01",
                "name": "资产负债率高于 70%",
                "triggered": True,
                "detail": f"实际 {round(ratio * 100, 2)}% > 70%",
            })
        else:
            out["thresholds"].append({
                "id": "R01",
                "name": "资产负债率高于 70%",
                "triggered": False,
                "detail": f"实际 {round(ratio * 100, 2)}% ≤ 70%",
            })

    # ---- 营业收入同比 ----
    if args.revenue_current is None or args.revenue_prior is None:
        out["notes"].append("缺少两期营业收入，未计算同比变动率")
    elif args.revenue_prior == 0:
        out["notes"].append("上期营业收入为 0，同比变动率无意义")
    else:
        yoy = (args.revenue_current - args.revenue_prior) / args.revenue_prior
        out["computed"]["revenue_yoy"] = {
            "value": round(yoy, 4),
            "percent": round(yoy * 100, 2),
            "formula": f"({args.revenue_current} - {args.revenue_prior}) / {args.revenue_prior}",
            "direction": "下降" if yoy < 0 else ("上升" if yoy > 0 else "持平"),
        }
        if yoy < -0.15:
            out["thresholds"].append({
                "id": "R02",
                "name": "营业收入同比下降超过 15%",
                "triggered": True,
                "detail": f"实际 {round(yoy * 100, 2)}% < -15%",
            })
        else:
            out["thresholds"].append({
                "id": "R02",
                "name": "营业收入同比下降超过 15%",
                "triggered": False,
                "detail": f"实际 {round(yoy * 100, 2)}% ≥ -15%",
            })

    # ---- 经营活动现金流 ----
    if args.ocf is None:
        out["notes"].append("缺少经营活动现金流量净额，未判断现金流方向")
    else:
        out["computed"]["operating_cash_flow"] = {
            "value": args.ocf,
            "unit": "万元",
            "negative": args.ocf < 0,
        }
        if args.ocf < 0:
            out["thresholds"].append({
                "id": "R03",
                "name": "经营活动现金流净额为负",
                "triggered": True,
                "detail": f"实际 {args.ocf} 万元",
            })
        else:
            out["thresholds"].append({
                "id": "R03",
                "name": "经营活动现金流净额为负",
                "triggered": False,
                "detail": f"实际 {args.ocf} 万元",
            })

    out["triggered_count"] = sum(1 for t in out["thresholds"] if t["triggered"])
    out["threshold_basis"] = "演示用虚构阈值，不代表行内正式授信政策"
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # 显式失败，不输出伪造成果
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        sys.exit(1)
