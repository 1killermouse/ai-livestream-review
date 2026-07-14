declare module 'ali-oss' {
  interface OssClientOptions {
    accessKeyId: string;
    accessKeySecret: string;
    bucket: string;
    endpoint?: string;
    region?: string;
    secure?: boolean;
  }

  interface PutResult {
    name: string;
    url?: string;
  }

  interface SignatureUrlOptions {
    expires?: number;
    method?: string;
  }

  interface MultipartInitResult {
    name: string;
    uploadId: string;
  }

  interface MultipartPartResult {
    name: string;
    etag: string;
  }

  interface MultipartPart {
    number: number;
    etag: string;
  }

  export default class OSS {
    constructor(options: OssClientOptions);
    put(name: string, file: string | Buffer): Promise<PutResult>;
    initMultipartUpload(
      name: string,
      options?: { mime?: string },
    ): Promise<MultipartInitResult>;
    uploadPart(
      name: string,
      uploadId: string,
      partNumber: number,
      file: string | Buffer,
      start: number,
      end: number,
    ): Promise<MultipartPartResult>;
    completeMultipartUpload(
      name: string,
      uploadId: string,
      parts: MultipartPart[],
    ): Promise<PutResult>;
    abortMultipartUpload(name: string, uploadId: string): Promise<void>;
    signatureUrl(name: string, options?: SignatureUrlOptions): string;
  }
}
