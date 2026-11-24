import { describe, expect, it } from "vitest";
import { createS3Store } from "./storage.ts";

// Points at a port nothing listens on, then swaps in a fake S3 client through the SDK's send.
const store = () =>
  createS3Store({
    endpoint: "http://127.0.0.1:9",
    publicEndpoint: "http://127.0.0.1:9",
    region: "fr-par",
    bucket: "kleidi-documents",
    accessKeyId: "k",
    secretAccessKey: "s",
  });

describe("ensureBucket", () => {
  it("accepts a bucket another process created at the same moment", async () => {
    const { S3Client } = await import("@aws-sdk/client-s3");
    const original = S3Client.prototype.send;
    S3Client.prototype.send = async function (command: { constructor: { name: string } }) {
      if (command.constructor.name === "HeadBucketCommand")
        throw Object.assign(new Error("not found"), { name: "NotFound" });
      throw Object.assign(new Error("owned"), { name: "BucketAlreadyOwnedByYou" });
    } as typeof original;
    try {
      await expect(store().ensureBucket()).resolves.toBeUndefined();
    } finally {
      S3Client.prototype.send = original;
    }
  });

  it("still reports other storage errors", async () => {
    const { S3Client } = await import("@aws-sdk/client-s3");
    const original = S3Client.prototype.send;
    S3Client.prototype.send = async function (command: { constructor: { name: string } }) {
      if (command.constructor.name === "HeadBucketCommand")
        throw Object.assign(new Error("not found"), { name: "NotFound" });
      throw Object.assign(new Error("denied"), { name: "AccessDenied" });
    } as typeof original;
    try {
      await expect(store().ensureBucket()).rejects.toThrow("denied");
    } finally {
      S3Client.prototype.send = original;
    }
  });
});
