import { normalizeKenyanPhone } from '@errandconnect/shared';
import { Transform } from 'class-transformer';
import { registerDecorator, ValidationOptions } from 'class-validator';

/**
 * Validates a Kenyan mobile number and converts it to +254... form.
 * Invalid numbers are left as-is so the validator can report them.
 */
export function IsKenyanPhone(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyKey) => {
    Transform(({ value }) => (typeof value === 'string' ? (normalizeKenyanPhone(value) ?? value) : value))(
      target,
      propertyKey,
    );
    registerDecorator({
      name: 'isKenyanPhone',
      target: target.constructor,
      propertyName: propertyKey as string,
      options: { message: `${String(propertyKey)} must be a valid Kenyan mobile number`, ...options },
      validator: {
        validate: (value: unknown) => typeof value === 'string' && normalizeKenyanPhone(value) === value,
      },
    });
  };
}

/** Trims strings and turns empty strings into undefined, so optional fields can be cleared. */
export const Trim = () =>
  Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  });
