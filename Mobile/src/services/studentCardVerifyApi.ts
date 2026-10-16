/** CARTE-PR2 — le cardToken n'est envoyé qu'au serveur, jamais persisté ni journalisé. */
import { httpRequest } from "./httpClient";
import type { CardVerifyResponse } from "../lib/studentCardVerify";

export function verifyStudentCardToken(cardToken: string) {
  return httpRequest<CardVerifyResponse>("/student-cards/verify", {
    method: "POST",
    body: JSON.stringify({ cardToken }),
  });
}
