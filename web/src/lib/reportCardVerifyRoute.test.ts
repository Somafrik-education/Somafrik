import { describe, expect, it } from "vitest";
import {
  isReportCardPublicVerifyPath,
  reportCardVerifyPublicPath,
  reportCardVerifyRouterBasename,
} from "./reportCardVerifyRoute";

describe("LOT 7 public verify route", () => {
  it("report-card-lot7-web-verify-outside-web-basename", () => {
    expect(reportCardVerifyRouterBasename("/verify/rc/pub.token", "/web")).toBeUndefined();
    expect(reportCardVerifyRouterBasename("/verify/rc/pub.token", "/web/")).toBeUndefined();
    expect(isReportCardPublicVerifyPath("/verify/rc/pub.token")).toBe(true);
    expect(reportCardVerifyPublicPath("pub-1")).toBe("/verify/rc/pub-1");
    expect(reportCardVerifyRouterBasename("/web/tableau-de-bord", "/web")).toBe("/web");
    expect(reportCardVerifyRouterBasename("/connexion", "/web")).toBe("/web");
  });
});
