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

  export default class OSS {
    constructor(options: OssClientOptions);
    put(name: string, file: string | Buffer): Promise<PutResult>;
    signatureUrl(name: string, options?: SignatureUrlOptions): string;
  }
}
