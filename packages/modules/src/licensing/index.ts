export { licenceToSetUp, mayStartLicence, requireLicence } from "./application.ts";
export {
  createLicensing,
  FRESH_MISSING_MS,
  FRESH_MS,
  openLicensing,
  STALE_MS,
  type Licensing,
  type LicensingConfig,
} from "./client.ts";
export {
  accessFor,
  caseLimit,
  hasFreeSeat,
  isReadMethod,
  setUpRefusal,
  type Access,
  type Licence,
  type LicenceStatus,
} from "./domain.ts";
