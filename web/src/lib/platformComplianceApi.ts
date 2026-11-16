import { api } from "../api/client";

export const PLATFORM_COMPLIANCE_PATH = "/backoffice/platform-compliance";

export type PlatformComplianceConfigured = {
  configured: boolean;
};

export type PlatformCompliancePayload = {
  schemaVersion: 1;
  scope: "platform";
  generatedAt: string;
  privacyRequests: {
    total: number;
    pending: number;
    processed: number;
    rejected: number;
  };
  capabilities: {
    privacyPolicy: PlatformComplianceConfigured;
    accountDeletionPage: PlatformComplianceConfigured;
    erasureRequestIntake: PlatformComplianceConfigured;
    selfErasure: PlatformComplianceConfigured;
    schoolDataExport: PlatformComplianceConfigured;
  };
  protections: {
    auditLogsPlatformDenied: boolean;
    schoolPrivacyRequestsPlatformDenied: boolean;
    schoolPrivacyExecutionPlatformDenied: boolean;
    schoolDataExportPlatformDenied: boolean;
    advancedReportsPlatformDenied: boolean;
  };
};

export function getPlatformCompliance() {
  return api.get<PlatformCompliancePayload>(PLATFORM_COMPLIANCE_PATH);
}
