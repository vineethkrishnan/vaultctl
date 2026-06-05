# German locale - machine-drafted

All `de/*.json` files in this directory were machine-drafted and need a review
by a native German speaker before release. Treat the wording as provisional.

Notes for the reviewer:
- Formal address ("Sie") is used throughout; switch to "du" if that fits the
  product voice better.
- "Tresor" is used for "vault" and "Zugangsdaten" for "logins/credentials" -
  confirm these are the preferred terms.
- Keys ending in `_one` / `_other` are i18next plural forms; keep both.
- `<1>...</1>` placeholders wrap React elements (via <Trans>) - keep them and
  their order intact.

Reviewed namespaces (tick when a native pass is done):
- [ ] common.json
- [ ] system.json
- [ ] account.json
- [ ] settings.json
