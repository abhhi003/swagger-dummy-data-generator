import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function generateDummyData(params: {
  schema: string;
  endpoint: string;
  rootCount: number;
  arrayMin: number;
  arrayMax: number;
  uniqueArrays: boolean;
  customRules: string;
  fieldMappings?: Record<string, string>;
}): Promise<string> {
  const { schema, endpoint, rootCount, arrayMin, arrayMax, uniqueArrays, customRules, fieldMappings = {} } = params;

  const explicitMappings = Object.entries(fieldMappings)
    .filter(([_, val]) => val !== '')
    .map(([path, gen]) => `- Path "${path}" -> MUST GENERATE EXACTLY AS: [${gen}]`)
    .join('\n');

  let prompt = `You are an expert API mock data generator.
Task: Generate dummy JSON data based on the provided Swagger/OpenAPI definition or JSON Schema.

Provided Schema / Definition:
---
${schema}
---

INSTRUCTIONS:
1. TARGET: ${
    endpoint.trim()
      ? `Find the requestBody schema for the endpoint/method "${endpoint}" in the provided definition and generate data for precisely that schema.`
      : `Assume the provided text is the exact schema or root definition you need to follow.`
  }
2. ROOT COUNT: ${
    rootCount > 1
      ? `Generate an ARRAY containing exactly ${rootCount} independently realistic objects matching the target schema.`
      : `Generate a SINGLE object matching the target schema (unless the base schema itself defines an array, in which case follow the schema but limit to ${rootCount} if applicable).`
  }
3. NESTED ARRAYS: By default, generate a random number of items between ${arrayMin} and ${arrayMax} for ANY nested arrays found in the schema. ${uniqueArrays ? 'CRITICAL: Ensure that all items within every generated array are absolutely UNIQUE with no duplicate objects or matching primary strings.' : ''} However, if the 'CUSTOM RULES' specifically mention different lengths or behaviors for certain arrays, prioritize those custom rules.
4. CUSTOM RULES & VALUES: ${
    customRules.trim()
      ? customRules + "\nCRITICAL OVERRIDE: You must strictly apply these rules. If a rule specifies a custom data type, format, pattern, or exact value for a specific field, it COMPLETELY OVERRIDES the original schema definition for that field."
      : "No custom rules provided."
  }
${explicitMappings ? `5. EXPLICIT FIELD MAPPING OVERRIDES:\nThe user has manually overridden specific schema paths to hardcoded data types. It is CRITICAL you follow these mappings perfectly:\n${explicitMappings}\nTHESE HIGHEST-PRIORITY MAPPINGS HAVE ABSOLUTE PRECEDENCE over everything else for those fields. Ignore all original schema format constraints for these targeted fields.` : ''}
${explicitMappings ? '6' : '5'}. REALISM: Treat the schema as real-world data. Generate highly realistic, context-aware mock data (e.g., real-looking names, valid emails, sensible UUIDs/dates, geographically accurate addresses). Do not use "string1", "string2", etc.
${explicitMappings ? '7' : '6'}. FORMAT: Respond ONLY with valid, raw JSON. Do not include explanatory text, and do not wrap it in markdown code blocks if returning via JSON constraints.

Generate the JSON now:`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      temperature: 0.7,
    },
  });

  return response.text || "{}";
}

export async function fixGeneratedData(params: {
  schema: string;
  endpoint: string;
  generatedData: string;
  validationErrors: string[];
}): Promise<string> {
  const { schema, endpoint, generatedData, validationErrors } = params;
  
  const prompt = `You are an expert API mock data generator. You previously generated some JSON data, but it failed schema validation.

ORIGINAL SCHEMA / DEFINITION:
---
${schema}
---
${endpoint.trim() ? `\nTARGET ENDPOINT / PATH: ${endpoint}\n` : ''}

PREVIOUSLY GENERATED JSON (HAS ERRORS):
---
${generatedData}
---

VALIDATION ERRORS TO FIX:
${validationErrors.map(e => `- ${e}`).join('\n')}

INSTRUCTIONS:
1. Analyze the PREVIOUSLY GENERATED JSON against the ORIGINAL SCHEMA and explicitly fix EVERY ONE of the VALIDATION ERRORS recorded above.
2. Ensure you modify the JSON structure, data types, formats, or missing properties so that it perfectly aligns with the required schema.
3. Keep the realistic dummy data where possible, just correct the structure/typing defects.
4. FORMAT: Respond ONLY with the fixed, valid raw JSON. Do not include explanatory text, and do not wrap it in markdown code blocks.`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      temperature: 0.2,
    },
  });

  return response.text || "{}";
}

export async function validateGeneratedData(params: {
  schema: string;
  endpoint: string;
  generatedData: string;
}): Promise<string[]> {
  const { schema, endpoint, generatedData } = params;

  let prompt = `You are a strict JSON schema and OpenAPI validation engine.
Task: Validate the provided JSON data against the provided Swagger/OpenAPI or JSON Schema definition.

Provided Schema / Definition:
---
${schema}
---

Target Context:
${
  endpoint.trim()
    ? `The data should map to the requestBody schema for the endpoint/method "${endpoint}".`
    : `The data should map to the root schema definition provided.`
}

Generated JSON Data:
---
${generatedData}
---

INSTRUCTIONS:
1. Deeply analyze the Generated JSON Data against the corresponding schema.
2. Identify missing required fields, type mismatches, enum violations, invalid formats, or unexpected properties (if additionalProperties: false).
3. If the Generated JSON Data is an array but the schema expects an object, check if the items IN the array match the schema (this occurs when users requested multiple records in batch). If the items match, DO NOT flag the array itself as an error.
4. Output ONLY a valid JSON array of strings, where each string describes a specific discrepancy mapped to its JSON path (e.g. "root.profile.email: Expected string but found boolean").
5. If there are absolutely no discrepancies, output an empty JSON array: []

Generate the validation array now:`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });

  const text = response.text || "[]";
  try {
    const list = JSON.parse(text);
    if (Array.isArray(list)) return list;
    return [];
  } catch (e) {
    return ["Failed to parse validation results output by the AI."];
  }
}

