export {
  canonicalize,
  canonicalString,
  CanonicalizationError,
  type JSONPrimitive,
  type JSONValue,
} from "./canonical.js";

export {
  EXPORT_ENVELOPE_VERSION,
  buildSignedEnvelope,
  buildSignedEnvelopeWithSigner,
  verifyEnvelope,
  EnvelopeError,
  EnvelopeSignatureError,
  EnvelopeUserMismatchError,
  EnvelopeVersionError,
  type IdentitySigner,
  type ExportEnvelope,
  type ExportEnvelopeBody,
  type ExportEnvelopeItem,
  type ExportEnvelopeVault,
  type ExportEnvelopeFolder,
} from "./envelope.js";
