import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ParamsList from '@/components/logging/ParamsList.vue'

describe('ParamsList', () => {
  it('renders nested objects, arrays, empty values, null, and undefined', () => {
    const wrapper = mount(ParamsList, {
      props: {
        params: {
          object: { name: 'civ', count: 7, ok: true },
          array: ['a', 'b'],
          emptyObject: {},
          emptyArray: [],
          nullValue: null,
          undefinedValue: undefined,
        },
      },
    })

    expect(wrapper.find('ul.param-object').exists()).toBe(true)
    expect(wrapper.html()).toContain('name: ')
    expect(wrapper.find('.param-string').text()).toBe('"civ"')
    expect(wrapper.find('.param-number').text()).toBe('7')
    expect(wrapper.find('.param-boolean').text()).toBe('true')
    expect(wrapper.find('ul.param-array').exists()).toBe(true)
    expect(wrapper.html()).toContain('[0]: ')
    expect(wrapper.findAll('.param-string')).toHaveLength(3)
    expect(wrapper.find('.param-null').text()).toBe('null')
    expect(wrapper.find('.param-undefined').text()).toBe('undefined')
    expect(wrapper.findAll('.param-empty').map((value) => value.text())).toEqual(['{}', '[]'])
  })
})
