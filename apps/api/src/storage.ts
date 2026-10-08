import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { prisma } from "./db.js";
import { env } from "./env.js";

const s3 = new S3Client({
  endpoint: env.s3Endpoint,
  region: env.s3Region,
  forcePathStyle: true,
  credentials: {
    accessKeyId: env.s3AccessKeyId,
    secretAccessKey: env.s3SecretAccessKey,
  },
});

export async function ensureBucket(): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: env.s3Bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: env.s3Bucket }));
  }
}

export function generateMediaKey(originalName: string): string {
  const ext = originalName.includes(".") ? originalName.split(".").pop() : "";
  return `${randomUUID()}${ext ? `.${ext}` : ""}`;
}

export async function putMedia(
  key: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: env.s3Bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

export interface StoredMedia {
  body: NodeJS.ReadableStream;
  contentType: string;
  contentLength?: number;
  contentRange?: string;
}

export async function getMedia(key: string, range?: string): Promise<StoredMedia | null> {
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: env.s3Bucket, Key: key, Range: range })
    );
    return {
      body: res.Body as NodeJS.ReadableStream,
      contentType: res.ContentType ?? "application/octet-stream",
      contentLength: res.ContentLength,
      contentRange: res.ContentRange,
    };
  } catch {
    return null;
  }
}

export async function deleteMedia(key: string): Promise<void> {
  try {
    await deleteMediaObject(key);
  } catch {
    // best-effort: don't fail the calling request if the object is already gone
  }
}

export async function deleteMediaObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: env.s3Bucket, Key: key }));
}

async function hasMediaReferences(key: string): Promise<boolean> {
  const [posts, stories, snaps, users] = await Promise.all([
    prisma.post.count({ where: { imageKey: key } }),
    prisma.story.count({ where: { imageKey: key } }),
    prisma.snap.count({ where: { imageKey: key } }),
    prisma.user.count({ where: { avatarKey: key } }),
  ]);
  return posts + stories + snaps + users > 0;
}

export async function purgeQueuedMediaDeletions(limit = 50): Promise<void> {
  const pending = await prisma.mediaDeletion.findMany({
    orderBy: { queuedAt: "asc" },
    take: limit,
  });
  for (const item of pending) {
    if (await hasMediaReferences(item.key)) {
      await prisma.mediaDeletion.delete({ where: { key: item.key } });
      continue;
    }
    try {
      await deleteMediaObject(item.key);
      await prisma.mediaAsset.deleteMany({ where: { key: item.key } });
      await prisma.mediaDeletion.delete({ where: { key: item.key } });
    } catch {
      await prisma.mediaDeletion.update({
        where: { key: item.key },
        data: { attempts: { increment: 1 } },
      });
    }
  }
}

export async function deleteMediaIfUnreferenced(key: string): Promise<void> {
  if (await hasMediaReferences(key)) return;
  await prisma.mediaDeletion.upsert({
    where: { key },
    create: { key },
    update: {},
  });
  await purgeQueuedMediaDeletions(1);
}
