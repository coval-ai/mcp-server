export function collectTopLevelJsonSchemaProperties(
  value: unknown,
  properties = new Set<string>(),
) {
  if (!value || typeof value !== 'object') return properties;
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTopLevelJsonSchemaProperties(item, properties);
    }
    return properties;
  }

  const record = value as Record<string, unknown>;
  if (record.properties && typeof record.properties === 'object') {
    for (const property of Object.keys(record.properties)) properties.add(property);
    return properties;
  }
  for (const nested of Object.values(record)) {
    collectTopLevelJsonSchemaProperties(nested, properties);
  }
  return properties;
}

export function collectJsonSchemaProperties(
  value: unknown,
  properties = new Set<string>(),
) {
  if (!value || typeof value !== 'object') return properties;
  if (Array.isArray(value)) {
    for (const item of value) collectJsonSchemaProperties(item, properties);
    return properties;
  }

  const record = value as Record<string, unknown>;
  if (record.properties && typeof record.properties === 'object') {
    for (const property of Object.keys(record.properties)) properties.add(property);
  }
  for (const nested of Object.values(record)) {
    collectJsonSchemaProperties(nested, properties);
  }
  return properties;
}

export function findOpenAdditionalProperties(
  value: unknown,
  path = '$',
  findings: string[] = [],
): string[] {
  if (!value || typeof value !== 'object') return findings;
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      findOpenAdditionalProperties(item, `${path}[${index}]`, findings),
    );
    return findings;
  }

  const record = value as Record<string, unknown>;
  if (
    'additionalProperties' in record &&
    record.additionalProperties !== false
  ) {
    findings.push(`${path}.additionalProperties`);
  }
  for (const [key, nested] of Object.entries(record)) {
    findOpenAdditionalProperties(nested, `${path}.${key}`, findings);
  }
  return findings;
}
