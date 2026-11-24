// Entity types as prefabs (US-014): a placed entity stores only the values that differ
// from what its type gives, so changing the type changes every copy that kept it.
// What the type gives is the default of one of its own properties, or a behaviour's
// property as the type sets it, else the behaviour's default. Codegen and the data
// section writer give an entity what it does not store the same way.
import { behaviourFields } from './behaviours.ts'
import type { EntityType } from './schema.ts'

type Value = number | boolean | string

/**
 * What an entity of `type` has for a property it does not set itself; undefined for a
 * name the type does not have, and for a behaviour property that is required and that
 * the type does not set. A type's property names are all different, as validation checks.
 */
export function typeValue(type: EntityType, name: string): Value | undefined {
  const own = type.props.find((p) => p.name === name)
  if (own) return own.default
  for (const use of type.behaviours) {
    const field = behaviourFields(use.id).find((f) => f.name === name)
    if (field) return use.props[name] ?? field.default
  }
  return undefined
}

/**
 * A placed entity's property as the panel shows it: its own value if it stores one,
 * else the type's. `inherited` is what it would be without its own.
 */
export function shownEntityValue(type: EntityType, entityProps: Record<string, Value>, name: string): { value: Value | undefined; inherited: Value | undefined; overridden: boolean } {
  const inherited = typeValue(type, name)
  const own = entityProps[name]
  return { value: own ?? inherited, inherited, overridden: own !== undefined }
}

/**
 * A placed entity's props with `name` set to `value`, or with its own value removed
 * (undefined). A value equal to what the type gives is not stored: the entity follows the type.
 */
export function entityOverride(type: EntityType, entityProps: Record<string, Value>, name: string, value: Value | undefined): Record<string, Value> {
  const { [name]: _, ...rest } = entityProps
  return value === undefined || value === typeValue(type, name) ? rest : { ...rest, [name]: value }
}

/** The names in an entity's props whose values are what its type gives anyway, in the props' order. A name the type does not have is not one. */
export function redundantProps(type: EntityType, entityProps: Record<string, Value>): string[] {
  return Object.entries(entityProps).flatMap(([name, value]) => (typeValue(type, name) === value ? [name] : []))
}

/**
 * The props with the redundant ones taken out. A name the type does not have is kept:
 * validation says so, and dropping it would hide the mistake.
 */
export function overriddenProps(type: EntityType, entityProps: Record<string, Value>): Record<string, Value> {
  const redundant = new Set(redundantProps(type, entityProps))
  return Object.fromEntries(Object.entries(entityProps).filter(([name]) => !redundant.has(name)))
}
