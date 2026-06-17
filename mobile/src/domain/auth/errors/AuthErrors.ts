// SPDX-License-Identifier: AGPL-3.0-or-later

export class AuthenticationError extends Error {
  constructor(message = 'Authentication failed') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class SessionExpiredError extends Error {
  constructor() {
    super('Session expired. Please log in again.');
    this.name = 'SessionExpiredError';
  }
}

export class TotpRequiredError extends Error {
  readonly email: string;

  constructor(email: string) {
    super('TOTP verification required');
    this.name = 'TotpRequiredError';
    this.email = email;
  }
}

export class BiometricNotEnrolledError extends Error {
  constructor() {
    super('Biometric unlock is not enrolled. Please log in with your master password.');
    this.name = 'BiometricNotEnrolledError';
  }
}

export class BiometricNotAvailableError extends Error {
  constructor() {
    super('Biometric authentication is not available on this device.');
    this.name = 'BiometricNotAvailableError';
  }
}

export class ServerNotConfiguredError extends Error {
  constructor() {
    super('No server URL configured. Please set up your server first.');
    this.name = 'ServerNotConfiguredError';
  }
}

export class InvalidServerUrlError extends Error {
  constructor(url: string) {
    super(`Invalid server URL: ${url}`);
    this.name = 'InvalidServerUrlError';
  }
}
