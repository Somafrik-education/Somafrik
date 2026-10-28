"use strict";

/**
 * MONO-L0 — catalogue des domaines encore inline.
 *
 * Aucune route n'est déplacée dans ce lot. L'ordre est celui des extractions
 * prévues : Finance (lot 1), puis élèves, utilisateurs, présences, notes,
 * planification, communications, administration, puis la plateforme.
 * Tant que le statut est `inline`, register() ne doit rien enregistrer.
 */

function registerNoRoute() {}

function inline(id) {
  return Object.freeze({
    id,
    status: "inline",
    register: registerNoRoute,
  });
}

const MODULE_CATALOG = Object.freeze([
  inline("finance"),
  inline("students"),
  inline("users"),
  inline("attendance"),
  inline("notes"),
  inline("planning"),
  inline("communications"),
  inline("administration"),
  inline("platform"),
]);

module.exports = {
  MODULE_CATALOG,
  registerNoRoute,
};
