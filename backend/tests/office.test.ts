import { it, expect } from "vitest";
import { validateOffice, validateOfficeXml } from "../src/validate";
import path from "node:path";
const fixture = (name: string) => path.resolve("tests/fixtures", name);
it.each(["docx", "pptx"])("validates a real %s archive", async (ext) =>
  expect(
    validateOffice(fixture("sample." + ext), "." + ext),
  ).resolves.toBeUndefined(),
);
it("rejects a DOCX renamed as PPTX", async () =>
  expect(validateOffice(fixture("sample.docx"), ".pptx")).rejects.toThrow(
    "contents do not match",
  ));
it("rejects externally linked Office resources", async () =>
  expect(
    validateOffice(fixture("unsafe-external.docx"), ".docx"),
  ).rejects.toThrow("External linked resources"));
it("rejects synthetic macro-containing archives", async () =>
  expect(validateOffice(fixture("unsafe-macro.docx"), ".docx")).rejects.toThrow(
    "macros",
  ));
it("rejects encoded and namespaced external relationship bypasses", () =>
  expect(() =>
    validateOfficeXml(
      '<r:Relationships xmlns:r="urn:rels"><r:Relationship TargetMode="&#69;xternal" Type="image" Target="file:///etc/passwd"/></r:Relationships>',
      true,
    ),
  ).toThrow("External linked"));
it("rejects document type declarations before entity expansion", () =>
  expect(() =>
    validateOfficeXml(
      '<!DOCTYPE x [<!ENTITY test "expansion">]><x>&test;</x>',
      false,
    ),
  ).toThrow("XML entities"));
it("allows normal external hyperlink relationships", () =>
  expect(() =>
    validateOfficeXml(
      '<Relationships><Relationship TargetMode="External" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com"/></Relationships>',
      true,
    ),
  ).not.toThrow());
