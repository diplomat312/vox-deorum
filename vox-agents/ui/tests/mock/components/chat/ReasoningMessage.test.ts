import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ReasoningMessage from '@/components/chat/ReasoningMessage.vue'

describe('ReasoningMessage', () => {
  it('expands to show the full content on header click', async () => {
    const wrapper = mount(ReasoningMessage, { props: { content: 'full reasoning text' } })

    await wrapper.find('.collapsible-header').trigger('click')

    expect(wrapper.find('.collapsible-content').exists()).toBe(true)
    expect(wrapper.find('.collapsible-content').text()).toBe('full reasoning text')
    expect(wrapper.find('.collapsible-preview').exists()).toBe(false)
  })
})
