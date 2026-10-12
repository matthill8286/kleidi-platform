import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "node:stream";

export type StorageConfig = {
  endpoint: string;
  // What browsers reach. Signed links are made for this host.
  publicEndpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export type ObjectStore = {
  ensureBucket(): Promise<void>;
  signUpload(key: string, mimeType: string, byteSize: number, seconds: number): Promise<string>;
  signDownload(key: string, fileName: string, seconds: number): Promise<string>;
  size(key: string): Promise<number | null>;
  // The ETag names the exact bytes read, so a later move can insist on the same object.
  read(key: string): Promise<{ body: Readable; etag: string }>;
  move(from: string, to: string, ifMatch?: string): Promise<void>;
  remove(key: string): Promise<void>;
};

/** S3-compatible storage: Scaleway Object Storage in production, SeaweedFS locally. */
export function createS3Store(config: StorageConfig): ObjectStore {
  const client = (endpoint: string) =>
    new S3Client({
      endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      // Checksums by default break signed uploads on S3-compatible stores.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  const s3 = client(config.endpoint);
  const signer = client(config.publicEndpoint);
  const Bucket = config.bucket;

  return {
    async ensureBucket() {
      try {
        await s3.send(new HeadBucketCommand({ Bucket }));
      } catch {
        await s3.send(new CreateBucketCommand({ Bucket }));
      }
    },
    signUpload: (key, mimeType, byteSize, seconds) =>
      getSignedUrl(
        signer,
        new PutObjectCommand({ Bucket, Key: key, ContentType: mimeType, ContentLength: byteSize }),
        { expiresIn: seconds },
      ),
    signDownload: (key, fileName, seconds) =>
      getSignedUrl(
        signer,
        new GetObjectCommand({
          Bucket,
          Key: key,
          ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        }),
        { expiresIn: seconds },
      ),
    async size(key) {
      try {
        const head = await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
        return head.ContentLength ?? null;
      } catch {
        return null;
      }
    },
    async read(key) {
      const res = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
      return { body: res.Body as Readable, etag: res.ETag ?? "" };
    },
    async move(from, to, ifMatch) {
      // With ifMatch, the copy fails if the object changed after it was read.
      await s3.send(
        new CopyObjectCommand({
          Bucket,
          Key: to,
          CopySource: `${Bucket}/${from}`,
          ...(ifMatch ? { CopySourceIfMatch: ifMatch } : {}),
        }),
      );
      await s3.send(new DeleteObjectCommand({ Bucket, Key: from }));
    },
    async remove(key) {
      await s3.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
  };
}
