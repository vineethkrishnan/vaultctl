// SPDX-License-Identifier: AGPL-3.0-or-later

import { UserId } from '../value-objects/UserId';

export interface SessionProps {
  readonly userId: UserId;
  readonly role: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly sessionId: string;
}

export class Session {
  readonly userId: UserId;
  readonly role: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly sessionId: string;

  private constructor(props: SessionProps) {
    if (!props.accessToken) throw new Error('Session: accessToken is required');
    if (!props.refreshToken) throw new Error('Session: refreshToken is required');
    this.userId = props.userId;
    this.role = props.role;
    this.accessToken = props.accessToken;
    this.refreshToken = props.refreshToken;
    this.sessionId = props.sessionId;
  }

  static create(props: SessionProps): Session {
    return new Session(props);
  }

  withTokens(accessToken: string, refreshToken: string): Session {
    return new Session({ ...this, accessToken, refreshToken });
  }

  equals(other: Session): boolean {
    return this.userId.equals(other.userId) && this.sessionId === other.sessionId;
  }
}
