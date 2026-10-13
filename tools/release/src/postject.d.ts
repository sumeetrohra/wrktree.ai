/** postject ships no types: the one call the single-file build makes. */
declare module "postject" {
  export function inject(
    filename: string,
    resourceName: string,
    resourceData: Buffer,
    options?: { sentinelFuse?: string; machoSegmentName?: string; overwrite?: boolean },
  ): Promise<void>;
}
