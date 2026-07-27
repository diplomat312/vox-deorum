/** Shared PrimeVue button stub with the selectors and state used by component tests. */
export const ButtonStub = {
  props: ['label', 'icon', 'disabled', 'loading', 'severity'],
  emits: ['click'],
  template: '<button class="p-btn" :data-icon="icon" :disabled="disabled" @click="$emit(\'click\', $event)">{{ label }}</button>',
}

/** Shared PrimeVue tag stub. */
export const TagStub = {
  props: ['value'],
  template: '<span class="p-tag">{{ value }}</span>',
}

/** Shared PrimeVue toolbar stub with all supported slot positions. */
export const ToolbarStub = {
  template: '<div class="p-toolbar"><slot name="start" /><slot /><slot name="end" /></div>',
}

/** Shared PrimeVue numeric input stub with editor limits exposed to tests. */
export const InputNumberStub = {
  props: ['modelValue', 'disabled', 'size', 'min', 'max'],
  emits: ['update:modelValue'],
  template: '<input class="number-stub" :disabled="disabled" :min="min" :max="max" :value="modelValue" @input="$emit(\'update:modelValue\', Number($event.target.value))" />',
}

/** Shared PrimeVue text input stub. */
export const InputTextStub = {
  props: ['modelValue', 'disabled'],
  emits: ['update:modelValue'],
  template: '<input class="text-stub" :disabled="disabled" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
}
