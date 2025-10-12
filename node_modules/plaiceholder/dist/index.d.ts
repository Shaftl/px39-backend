/// <reference types="node" />
import sharp, { type Sharp, type Metadata, OutputInfo } from "sharp";
interface GetPixelsOptions {
    data: Buffer;
    info: sharp.OutputInfo;
}
type GetPixelsReturn = ReturnType<typeof getPixels>;
declare const getPixels: ({ data, info }: GetPixelsOptions) => {
    a?: number;
    r: number;
    g: number;
    b: number;
}[][];
interface GetCSSOptions {
    info: OutputInfo;
    pixels: GetPixelsReturn;
}
type GetCSSReturn = ReturnType<typeof getCSS>;
declare const getCSS: ({ pixels, info }: GetCSSOptions) => {
    backgroundImage: string;
    backgroundPosition: string;
    backgroundSize: string;
    backgroundRepeat: string;
};
type TRects = [
    "rect",
    Record<"width" | "height" | "x" | "y" | "fillOpacity", {} & number> & Record<"fill", {} & string>
];
type GetSVGReturn = [
    "svg",
    {
        viewBox: string;
        width: string;
        height: string;
        shapeRendering: string;
        preserveAspectRatio: string;
        style: any;
        xmlns: string;
    },
    TRects[]
];
type SharpFormatOptions = Parameters<Sharp["toFormat"]>;
type SharpModulateOptions = NonNullable<Parameters<Sharp["modulate"]>[0]>;
export type GetPlaiceholderSrc = Buffer;
export interface GetPlaiceholderOptions extends SharpModulateOptions {
    autoOrient?: boolean;
    size?: number;
    format?: SharpFormatOptions;
    removeAlpha?: boolean;
}
export interface GetPlaiceholderReturn {
    metadata: Omit<Metadata, "width" | "height"> & Required<Pick<Metadata, "width" | "height">>;
    base64: string;
    color: {
        hex: string;
        r: number;
        g: number;
        b: number;
    };
    pixels: GetPixelsReturn;
    css: GetCSSReturn;
    svg: GetSVGReturn;
}
export declare const getPlaiceholder: (src: GetPlaiceholderSrc, { autoOrient, size, format, brightness, saturation, removeAlpha, ...options }?: GetPlaiceholderOptions) => Promise<{
    color: {
        r: number;
        g: number;
        b: number;
        hex: string;
    };
    css: {
        backgroundImage: string;
        backgroundPosition: string;
        backgroundSize: string;
        backgroundRepeat: string;
    };
    base64: string;
    metadata: {
        orientation?: number;
        format?: keyof sharp.FormatEnum;
        size?: number;
        space?: keyof sharp.ColourspaceEnum;
        channels?: sharp.Channels;
        depth?: string;
        density?: number;
        chromaSubsampling: string;
        isProgressive?: boolean;
        pages?: number;
        pageHeight?: number;
        loop?: number;
        delay?: number[];
        pagePrimary?: number;
        hasProfile?: boolean;
        hasAlpha?: boolean;
        exif?: Buffer;
        icc?: Buffer;
        iptc?: Buffer;
        xmp?: Buffer;
        tifftagPhotoshop?: Buffer;
        compression?: "av1" | "hevc";
        background?: number | {
            r: number;
            g: number;
            b: number;
        };
        levels?: sharp.LevelMetadata[];
        subifds?: number;
        resolutionUnit?: "inch" | "cm";
        formatMagick?: string;
        width: number;
        height: number;
    };
    pixels: {
        a?: number;
        r: number;
        g: number;
        b: number;
    }[][];
    svg: GetSVGReturn;
}>;
export {};
