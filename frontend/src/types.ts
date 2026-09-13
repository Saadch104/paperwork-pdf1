export type Matrix = [number, number, number, number, number, number];
export type FontFamily = "Helvetica" | "Times" | "Courier";
export type Tool =
  | "text"
  | "links"
  | "forms"
  | "images"
  | "sign"
  | "whiteout"
  | "annotate"
  | "shapes";
export interface TextBlock {
  id: string;
  page: number;
  text: string;
  matrix: Matrix;
  width: number;
  size: number;
  ascent: number;
  descent: number;
  family: FontFamily;
  bold: boolean;
  italic: boolean;
  color: string;
}
export interface Edit {
  id: string;
  page: number;
  kind:
    | "text"
    | "whiteout"
    | "highlight"
    | "rectangle"
    | "ellipse"
    | "image"
    | "signature"
    | "link"
    | "form";
  matrix: Matrix;
  width: number;
  height: number;
  text: string;
  size: number;
  color: string;
  background: string;
  family: FontFamily;
  bold: boolean;
  italic: boolean;
  original?: TextBlock;
  dataUrl?: string;
  url?: string;
  fieldName?: string;
}
export interface PageInfo {
  width: number;
  height: number;
  transform: Matrix;
  rotation: number;
}
