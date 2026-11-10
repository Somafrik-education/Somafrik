"use strict";

/**
 * BULLETIN-CLASSE-01 / L1 — rejoue reportCardLot11.pg.test.js sur le schéma MIGRÉ
 * (20261105_report_card_class_scope.sql) : liaisons établissement, RBAC et isolation
 * inchangées après migration. Base jetable distincte.
 */

process.env.SOMAFRIK_TEST_CLASS_SCOPE_MIGRATION = "1";
process.env.SOMAFRIK_REPORT_CARD_LOT11_IT_DATABASE = "somafrik_report_card_lot11_class_scope_it";
require("./reportCardLot11.pg.test.js");
