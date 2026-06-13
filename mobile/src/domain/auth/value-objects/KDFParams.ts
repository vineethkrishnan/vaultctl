// SPDX-License-Identifier: AGPL-3.0-or-later

export class KDFParams {
  private constructor(
    readonly iterations: number,
    readonly memoryKB: number,
    readonly parallelism: number,
  ) {}

  static readonly MIN_ITERATIONS = 3;
  static readonly MIN_MEMORY_KB = 65536;
  static readonly MAX_MEMORY_KB = 1048576;
  static readonly MIN_PARALLELISM = 1;

  static of(iterations: number, memoryKB: number, parallelism: number): KDFParams {
    if (iterations < KDFParams.MIN_ITERATIONS) {
      throw new Error(`KDFParams: iterations must be >= ${KDFParams.MIN_ITERATIONS}`);
    }
    if (memoryKB < KDFParams.MIN_MEMORY_KB) {
      throw new Error(`KDFParams: memoryKB must be >= ${KDFParams.MIN_MEMORY_KB} (64 MiB)`);
    }
    if (memoryKB > KDFParams.MAX_MEMORY_KB) {
      throw new Error(`KDFParams: memoryKB must be <= ${KDFParams.MAX_MEMORY_KB}`);
    }
    if (parallelism < KDFParams.MIN_PARALLELISM) {
      throw new Error(`KDFParams: parallelism must be >= ${KDFParams.MIN_PARALLELISM}`);
    }
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
