// SPDX-License-Identifier: AGPL-3.0-or-later

export class KDFParams {
  private constructor(
    readonly iterations: number,
    readonly memoryKB: number,
    readonly parallelism: number,
  ) {}

  static of(iterations: number, memoryKB: number, parallelism: number): KDFParams {
    if (iterations < 1) throw new Error('KDFParams: iterations must be >= 1');
    if (memoryKB < 1024) throw new Error('KDFParams: memoryKB must be >= 1024');
    if (parallelism < 1) throw new Error('KDFParams: parallelism must be >= 1');
    return new KDFParams(iterations, memoryKB, parallelism);
  }

  static defaults(): KDFParams {
    return new KDFParams(3, 65536, 4);
  }

  equals(other: KDFParams): boolean {
    return (
      this.iterations === other.iterations &&
      this.memoryKB === other.memoryKB &&
      this.parallelism === other.parallelism
    );
  }
}
