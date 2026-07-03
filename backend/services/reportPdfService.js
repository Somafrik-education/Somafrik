const { renderReportCardPdf } = require("./bulletinPdfRenderer");

class ReportPdfService {
  constructor({ school }) {
    this.school = school;
  }

  async generateReportCardPdf(report) {
    return renderReportCardPdf(report, this.school);
  }
}

module.exports = { ReportPdfService };
