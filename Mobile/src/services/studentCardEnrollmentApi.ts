import { httpRequest } from "./httpClient";
import { createNfcEnrollmentApi } from "../lib/studentCardNfcEncoding";

export const studentCardEnrollmentApi = createNfcEnrollmentApi(httpRequest);
