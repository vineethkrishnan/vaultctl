// SPDX-License-Identifier: AGPL-3.0-or-later

package com.vaultctl.app.autofill

import android.app.PendingIntent
import android.app.assist.AssistStructure
import android.content.Intent
import android.content.IntentSender
import android.os.Build
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.Presentations
import android.service.autofill.SaveCallback
import android.service.autofill.SaveRequest
import android.text.InputType
import android.view.View
import android.view.autofill.AutofillId
import android.widget.RemoteViews
import com.vaultctl.app.MainActivity
import com.vaultctl.app.R

/**
 * Answers system fill requests with an unlock prompt and nothing else.
 *
 * The whole response is authentication-gated, so no vault data crosses into
 * this process: Android shows the unlock entry, and only after the user picks
 * it does MainActivity run and decide what to hand back. Returning datasets
 * directly would require the fill process to reach key material, and that
 * sharing boundary is unresolved - see the autofill section of
 * _knowledgebase/mobile-architecture.md before adding one.
 */
class VaultAutofillService : AutofillService() {

  override fun onFillRequest(
    request: FillRequest,
    cancellationSignal: CancellationSignal,
    callback: FillCallback,
  ) {
    val structure = request.fillContexts.lastOrNull()?.structure
    if (structure == null) {
      callback.onSuccess(null)
      return
    }

    val credentialFields = collectCredentialFields(structure)
    if (credentialFields.isEmpty()) {
      callback.onSuccess(null)
      return
    }

    callback.onSuccess(buildUnlockResponse(credentialFields.toTypedArray()))
  }

  override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
    callback.onFailure("Saving to vaultctl from autofill is not supported yet.")
  }

  private fun collectCredentialFields(structure: AssistStructure): List<AutofillId> {
    val found = mutableListOf<AutofillId>()
    for (windowIndex in 0 until structure.windowNodeCount) {
      collectFrom(structure.getWindowNodeAt(windowIndex).rootViewNode, found)
    }
    return found
  }

  private fun collectFrom(node: AssistStructure.ViewNode, found: MutableList<AutofillId>) {
    if (isCredentialField(node)) {
      node.autofillId?.let(found::add)
    }
    for (childIndex in 0 until node.childCount) {
      collectFrom(node.getChildAt(childIndex), found)
    }
  }

  private fun isCredentialField(node: AssistStructure.ViewNode): Boolean {
    if (node.autofillType == View.AUTOFILL_TYPE_NONE) return false
    val hints = node.autofillHints
    if (hints != null && hints.any { it in CREDENTIAL_HINTS }) return true
    return isPasswordInput(node)
  }

  private fun isPasswordInput(node: AssistStructure.ViewNode): Boolean {
    if (node.autofillType != View.AUTOFILL_TYPE_TEXT) return false
    return when (node.inputType and InputType.TYPE_MASK_VARIATION) {
      InputType.TYPE_TEXT_VARIATION_PASSWORD,
      InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD,
      InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD,
      -> true
      else -> false
    }
  }

  /**
   * The RemoteViews overload is the only one that reaches back to minSdk, and
   * the Presentations overload is the only one that is not deprecated from
   * API 33. Both are needed to cover the supported range.
   */
  private fun buildUnlockResponse(credentialFields: Array<AutofillId>): FillResponse {
    val builder = FillResponse.Builder()
    val unlockIntent = buildUnlockIntentSender()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      builder.setAuthentication(
        credentialFields,
        unlockIntent,
        Presentations.Builder().setMenuPresentation(buildUnlockPresentation()).build(),
      )
    } else {
      @Suppress("DEPRECATION")
      builder.setAuthentication(credentialFields, unlockIntent, buildUnlockPresentation())
    }

    return builder.build()
  }

  private fun buildUnlockIntentSender(): IntentSender {
    val intent = Intent(this, MainActivity::class.java)
    return PendingIntent
      .getActivity(this, 0, intent, PendingIntent.FLAG_CANCEL_CURRENT or mutabilityFlag())
      .intentSender
  }

  private fun buildUnlockPresentation(): RemoteViews =
    RemoteViews(packageName, R.layout.autofill_unlock)

  /**
   * The platform writes the fill result back into this intent, so it cannot be
   * immutable. FLAG_MUTABLE only exists from S onwards, and only S onwards
   * rejects a PendingIntent that declares neither.
   */
  private fun mutabilityFlag(): Int =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0

  private companion object {
    val CREDENTIAL_HINTS = setOf(
      View.AUTOFILL_HINT_USERNAME,
      View.AUTOFILL_HINT_EMAIL_ADDRESS,
      View.AUTOFILL_HINT_PASSWORD,
    )
  }
}
