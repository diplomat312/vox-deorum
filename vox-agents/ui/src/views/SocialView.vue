<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Button from 'primevue/button'
import Card from 'primevue/card'
import Checkbox from 'primevue/checkbox'
import InputText from 'primevue/inputtext'
import Dropdown from 'primevue/dropdown'
import Textarea from 'primevue/textarea'
import Tag from 'primevue/tag'
import { api } from '../api/client'
import type { SocialActor, SocialChannel, SocialMessage, SocialStoredSession } from '../utils/types'

const actors = ref<SocialActor[]>([])
const channels = ref<SocialChannel[]>([])
const messages = ref<SocialMessage[]>([])
const selectedChannelId = ref('world')
const displayName = ref('Human')
const groupTitle = ref('')
const selectedInvitees = ref<string[]>([])
const modelSelections = ref<string[]>([
  'inclusionai/ling-3.0-flash-fin:free',
  'dots-studio/dots-3-note-preview:free',
  'nvidia/nemotron-3.5-lightning:free',
])
const modelOptions = ref<Array<{ label: string; value: string }>>([
  { label: 'Ling 3.0 Flash Fin (free)', value: 'inclusionai/ling-3.0-flash-fin:free' },
  { label: 'Dots 3 Note Preview (free)', value: 'dots-studio/dots-3-note-preview:free' },
  { label: 'Nemotron 3.5 Lightning (free)', value: 'nvidia/nemotron-3.5-lightning:free' },
])
const excludedModelIds = new Set(['liquid/lfm-2.5-2.6b:free'])
const cleoFallbackModel = 'nvidia/nemotron-3.5-lightning:free'
const composer = ref('')
const loading = ref(false)
const sending = ref(false)
const error = ref('')
const sessionActive = ref(false)
const storedSessions = ref<SocialStoredSession[]>([])
const messagesPane = ref<HTMLElement | null>(null)
let stopEvents: (() => void) | undefined
const router = useRouter()

const selectedChannel = computed(() => channels.value.find((channel) => channel.id === selectedChannelId.value))
const aiActors = computed(() => actors.value.filter((actor) => actor.control === 'model'))
const dmChannels = computed(() => channels.value.filter((channel) => channel.kind === 'dm'))
const groupChannels = computed(() => channels.value.filter((channel) => channel.kind === 'group'))

/** Keep persisted OpenRouter references compatible with the UI model catalog. */
function normalizeModelRef(modelRef: string | undefined): string {
  return modelRef?.replace(/^openrouter\//, '') ?? ''
}

/** Copy resumed actor assignments into the setup controls used by the next session. */
function syncModelSelections(resumedActors: SocialActor[]): void {
  for (const [index, actorId] of ['alice', 'bob', 'cleo'].entries()) {
    const modelRef = resumedActors.find((actor) => actor.id === actorId)?.modelRef
    if (modelRef && !excludedModelIds.has(normalizeModelRef(modelRef))) modelSelections.value[index] = normalizeModelRef(modelRef)
  }
}

/** Replace the removed LFM assignment while keeping a running session alive. */
async function migrateRemovedCleoModel(currentActors: SocialActor[]): Promise<SocialActor[]> {
  const cleo = currentActors.find((actor) => actor.id === 'cleo')
  if (!cleo?.modelRef || !excludedModelIds.has(normalizeModelRef(cleo.modelRef))) return currentActors
  try {
    const updatedCleo = await api.updateSocialActorModel(cleo.id, cleoFallbackModel)
    return currentActors.map((actor): SocialActor => actor.id === updatedCleo.id ? updatedCleo : actor)
  } catch {
    return currentActors
  }
}

/** Return to the Social Sandbox landing menu. */
function goToSandboxMenu(): void {
  void router.push('/social')
}

/** Refresh the session, channel list, and current transcript. */
async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    try {
      const discovered = await api.getConfigModels()
      const freeModels = discovered.models.filter((model) => model.id.endsWith(':free')).map((model) => ({ label: model.name, value: model.id.replace(/^openrouter\//, '') })).filter((model) => !excludedModelIds.has(model.value))
      if (freeModels.length) modelOptions.value = freeModels
    } catch { /* The curated free defaults keep setup usable without discovery credentials. */ }
    const session = await api.getSocialSession()
    sessionActive.value = true
    actors.value = await migrateRemovedCleoModel(session.actors)
    syncModelSelections(actors.value)
    await loadChannels()
    connectEvents()
  } catch {
    sessionActive.value = false
    try { storedSessions.value = (await api.getStoredSocialSessions()).sessions } catch { storedSessions.value = [] }
  } finally {
    loading.value = false
  }
}

/** Refresh visible channels and select WORLD when the current channel disappears. */
async function loadChannels(): Promise<void> {
  const response = await api.getSocialChannels()
  channels.value = response.channels
  if (!channels.value.some((channel) => channel.id === selectedChannelId.value)) selectedChannelId.value = 'world'
  await loadMessages()
}

/** Load the selected channel transcript. */
async function loadMessages(): Promise<void> {
  if (!selectedChannelId.value) return
  try { messages.value = (await api.getSocialMessages(selectedChannelId.value)).messages } catch (caught) { error.value = caught instanceof Error ? caught.message : 'Could not load messages' }
  await scrollToLatest()
}

/** Start a small local social sandbox with three model actors. */
async function start(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const response = await api.startSocialSession({ actors: [
      { id: 'human', ordinal: 0, control: 'human', displayName: displayName.value || 'Human' },
      { id: 'alice', ordinal: 1, control: 'model', displayName: 'Alice', modelRef: modelSelections.value[0], profile: 'Thoughtful, curious, and diplomatic.' },
      { id: 'bob', ordinal: 2, control: 'model', displayName: 'Bob', modelRef: modelSelections.value[1], profile: 'Skeptical, direct, and strategic.' },
      { id: 'cleo', ordinal: 3, control: 'model', displayName: 'Cleo', modelRef: modelSelections.value[2], profile: 'Warm, observant, and mischievous.' },
    ] })
    actors.value = response.actors
    sessionActive.value = true
    await loadChannels()
    connectEvents()
  } catch (caught) { error.value = caught instanceof Error ? caught.message : 'Could not start social session' } finally { loading.value = false }
}

/** Resume a persisted social session after a server restart. */
async function resume(sessionId: string): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const response = await api.resumeSocialSession(sessionId)
    let resumedActors: SocialActor[] = response.actors.map((actor): SocialActor => actor.modelRef ? { ...actor, modelRef: normalizeModelRef(actor.modelRef) } : actor)
    resumedActors = await migrateRemovedCleoModel(resumedActors)
    actors.value = resumedActors
    syncModelSelections(resumedActors)
    sessionActive.value = true
    storedSessions.value = []
    selectedChannelId.value = 'world'
    await loadChannels()
    connectEvents()
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : 'Could not resume social session'
  } finally {
    loading.value = false
  }
}

/** Send the human's message and refresh immediately while model replies arrive over SSE. */
async function send(): Promise<void> {
  const content = composer.value.trim()
  if (!content || !selectedChannelId.value) return
  sending.value = true
  error.value = ''
  try { const message = await api.sendSocialMessage(selectedChannelId.value, content); messages.value.push(message); composer.value = ''; await scrollToLatest() } catch (caught) { error.value = caught instanceof Error ? caught.message : 'Could not send message' } finally { sending.value = false }
}

/** Open a private human DM with one model actor. */
async function openDm(actorId: string): Promise<void> { try { const channel = await api.openSocialDm(actorId); await loadChannels(); selectedChannelId.value = channel.id; await loadMessages() } catch (caught) { error.value = caught instanceof Error ? caught.message : 'Could not open DM' } }

/** Create a titled private group. */
async function createGroup(): Promise<void> { const title = groupTitle.value.trim(); if (!title) return; try { const channel = await api.createSocialGroup(title, selectedInvitees.value); groupTitle.value = ''; selectedInvitees.value = []; await loadChannels(); selectedChannelId.value = channel.id; await loadMessages() } catch (caught) { error.value = caught instanceof Error ? caught.message : 'Could not create group' } }

/** Change an actor's model for future replies without interrupting the session. */
async function changeActorModel(actor: SocialActor, modelRef: string): Promise<void> { try { const updated = await api.updateSocialActorModel(actor.id, modelRef); actors.value = actors.value.map((candidate) => candidate.id === updated.id ? updated : candidate) } catch (caught) { error.value = caught instanceof Error ? caught.message : 'Could not update model' } }

/** Return a display name for a speaker ID. */
function actorName(actorId: string): string { return actors.value.find((actor) => actor.id === actorId)?.displayName ?? actorId }

/** Select a channel and load its transcript. */
async function selectChannel(channelId: string): Promise<void> { selectedChannelId.value = channelId; await loadMessages() }

/** Scroll the active transcript to its newest committed message. */
async function scrollToLatest(): Promise<void> { await nextTick(); if (messagesPane.value) messagesPane.value.scrollTop = messagesPane.value.scrollHeight }

/** Connect the live event stream only after a social session exists. */
function connectEvents(): void { stopEvents?.(); stopEvents = api.streamSocialEvents(async () => { await loadChannels() }) }

onMounted(async () => { await load() })
onUnmounted(() => stopEvents?.())
</script>

<template>
  <div class="social-page">
    <div class="page-header">
      <div><h1>Social Sandbox</h1><p class="text-muted">A persistent multi-agent conversation space for Vox Deorum.</p></div>
      <div class="flex gap-2 align-items-center"><Button label="Sandbox menu" icon="pi pi-home" text severity="secondary" @click="goToSandboxMenu" /><Tag v-if="sessionActive" severity="success" value="Live" /><Button v-if="sessionActive" label="Stop" icon="pi pi-stop" severity="secondary" @click="api.stopSocialSession().then(load)" /></div>
    </div>
    <div v-if="error" class="social-error">{{ error }}</div>
    <Card v-if="!sessionActive" class="social-start-card">
      <template #title>Start a social sandbox</template>
      <template #content><p class="text-muted">Chat with three independent model actors without launching Civilization V.</p><div class="model-setup"><label v-for="(model, index) in modelSelections" :key="index">{{ ['Alice', 'Bob', 'Cleo'][index] }}<Dropdown v-model="modelSelections[index]" :options="modelOptions" option-label="label" option-value="value" /></label></div><div class="flex gap-2 mt-3"><InputText v-model="displayName" placeholder="Your display name" /><Button label="Start sandbox" icon="pi pi-play" :loading="loading" @click="start" /></div></template>
    </Card>
    <Card v-if="!sessionActive && storedSessions.length" class="social-start-card stored-card"><template #title>Resume a saved sandbox</template><template #content><div v-for="saved in storedSessions" :key="saved.session.id" class="stored-session"><div><strong>{{ saved.session.id }}</strong><small>{{ saved.actors.length }} actors · {{ saved.actors.filter((actor) => actor.control === 'model').map((actor) => actor.displayName).join(', ') }}</small></div><Button label="Resume" icon="pi pi-history" size="small" :loading="loading" @click="resume(saved.session.id)" /></div></template></Card>
    <div v-if="sessionActive" class="social-shell">
      <aside class="social-sidebar">
        <Button class="world-button" :class="{ active: selectedChannelId === 'world' }" text @click="selectChannel('world')"><i class="pi pi-globe" /><span>WORLD</span></Button>
        <h3>Direct messages</h3>
        <Button v-for="actor in aiActors" :key="actor.id" text class="channel-button" @click="openDm(actor.id)"><i class="pi pi-user" /><span>{{ actor.displayName }}</span></Button>
        <Button v-for="channel in dmChannels" :key="channel.id" text class="channel-button" :class="{ active: selectedChannelId === channel.id }" @click="selectChannel(channel.id)"><i class="pi pi-lock" /><span>{{ channel.title }}</span></Button>
        <h3>Groups</h3>
        <Button v-for="channel in groupChannels" :key="channel.id" text class="channel-button" :class="{ active: selectedChannelId === channel.id }" @click="selectChannel(channel.id)"><i class="pi pi-users" /><span>{{ channel.title }}</span></Button>
        <div class="group-create"><InputText v-model="groupTitle" placeholder="New group title" /><div v-for="actor in aiActors" :key="actor.id" class="flex align-items-center gap-2 mt-2"><Checkbox v-model="selectedInvitees" :input-id="actor.id" :value="actor.id" /><label :for="actor.id">{{ actor.displayName }}</label></div><Button class="mt-3" label="Create group" icon="pi pi-plus" size="small" :disabled="!groupTitle.trim()" @click="createGroup" /></div>
      </aside>
      <main class="social-conversation">
        <header class="conversation-header"><div><h2>{{ selectedChannel?.title ?? 'WORLD' }}</h2><span class="text-muted">{{ selectedChannel?.kind === 'world' ? 'Everyone in the session' : 'Private conversation' }}</span></div><i class="pi pi-comments text-primary text-xl" /></header>
        <div ref="messagesPane" class="social-messages"><div v-if="!messages.length" class="empty-state"><i class="pi pi-inbox" /><p>No messages yet. Start the conversation.</p></div><article v-for="message in messages" :key="message.id" class="social-message" :class="{ human: message.speakerActorId === 'human' }"><div class="message-author">{{ actorName(message.speakerActorId) }}<span>{{ new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}</span></div><div>{{ message.content }}</div></article></div>
        <div class="social-composer"><Textarea v-model="composer" auto-resize rows="2" placeholder="Say something to the group..." @keydown.enter.exact.prevent="send" /><Button icon="pi pi-send" aria-label="Send" :loading="sending" :disabled="!composer.trim()" @click="send" /></div>
      </main>
      <aside class="social-details"><h3>Actors</h3><div v-for="actor in actors" :key="actor.id" class="actor-row"><span class="actor-dot" :class="actor.control" /> <span>{{ actor.displayName }}</span><small v-if="actor.control === 'human'">You</small><Dropdown v-else v-model="actor.modelRef" :options="modelOptions" option-label="label" option-value="value" class="actor-model" @update:model-value="changeActorModel(actor, $event)" /></div><p class="text-muted text-small mt-4">Model changes apply to future replies and do not interrupt the current session.</p></aside>
    </div>
  </div>
</template>

<style scoped>
.social-page { height: 100%; display: flex; flex-direction: column; }
.social-error { background: var(--p-red-50); color: var(--p-red-700); border: 1px solid var(--p-red-200); border-radius: 6px; padding: .75rem 1rem; margin-bottom: 1rem; }
.social-start-card { max-width: 680px; margin: 3rem auto; width: 100%; }
.stored-card { margin-top: 0; }.stored-session { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .75rem 0; border-bottom: 1px solid var(--p-content-border-color); }.stored-session:last-child { border-bottom: 0; }.stored-session small { display: block; color: var(--p-text-muted-color); margin-top: .2rem; }
.model-setup { display: grid; grid-template-columns: repeat(3, 1fr); gap: .75rem; margin-top: 1.25rem; }.model-setup label { display: flex; flex-direction: column; gap: .35rem; font-size: .8rem; font-weight: 700; }.model-setup .p-dropdown { width: 100%; font-weight: 400; }
.social-shell { flex: 1; min-height: 0; display: grid; grid-template-columns: 230px minmax(0, 1fr) 220px; border: 1px solid var(--p-content-border-color); border-radius: 8px; overflow: hidden; background: var(--p-content-background); }
.social-sidebar, .social-details { padding: 1rem; overflow-y: auto; background: var(--p-content-hover-background); }
.social-sidebar h3, .social-details h3 { font-size: .8rem; text-transform: uppercase; letter-spacing: .06em; color: var(--p-text-muted-color); margin: 1rem 0 .5rem; }
.world-button, .channel-button { width: 100%; justify-content: flex-start; gap: .65rem; color: var(--p-text-color); }
.world-button.active, .channel-button.active { background: var(--p-highlight-background); color: var(--p-highlight-color); }
.group-create { border-top: 1px solid var(--p-content-border-color); margin-top: 1rem; padding-top: 1rem; }
.group-create .p-inputtext { width: 100%; }
.social-conversation { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.conversation-header { padding: 1rem 1.25rem; border-bottom: 1px solid var(--p-content-border-color); display: flex; justify-content: space-between; align-items: center; }
.conversation-header h2 { margin: 0; }
.social-messages { flex: 1; min-height: 0; overflow-y: auto; padding: 1.25rem; }
.social-message { max-width: 80%; padding: .7rem .9rem; margin-bottom: .8rem; border-radius: 8px; background: var(--p-content-hover-background); white-space: pre-wrap; }
.social-message.human { margin-left: auto; background: var(--p-primary-50); border-right: 3px solid var(--p-primary-500); }
.message-author { font-weight: 700; margin-bottom: .25rem; color: var(--p-primary-700); }.message-author span { font-weight: 400; color: var(--p-text-muted-color); font-size: .72rem; margin-left: .5rem; }
.social-composer { display: flex; gap: .75rem; padding: 1rem; border-top: 1px solid var(--p-content-border-color); }.social-composer .p-textarea { flex: 1; }
.actor-row { display: grid; grid-template-columns: 10px 1fr; gap: .5rem; align-items: center; margin-bottom: .7rem; }.actor-row small { grid-column: 2; color: var(--p-text-muted-color); font-size: .7rem; }.actor-model { grid-column: 2; width: 100%; font-size: .72rem; }.actor-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--p-green-500); }.actor-dot.human { background: var(--p-primary-500); }
@media (max-width: 900px) { .social-shell { grid-template-columns: 180px minmax(0, 1fr); }.social-details { display: none; } }
</style>
