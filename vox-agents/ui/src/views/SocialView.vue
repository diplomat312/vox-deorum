<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Button from 'primevue/button'
import Card from 'primevue/card'
import Checkbox from 'primevue/checkbox'
import InputText from 'primevue/inputtext'
import Dropdown from 'primevue/dropdown'
import Textarea from 'primevue/textarea'
import Tag from 'primevue/tag'
import { api } from '../api/client'
import type { SocialActor, SocialChannel, SocialMessage, SocialSessionResponse, SocialStartRequest, SocialStoredSession } from '../utils/types'

const actors = ref<SocialActor[]>([])
const channels = ref<SocialChannel[]>([])
const messages = ref<SocialMessage[]>([])
const selectedChannelId = ref('world')
const displayName = ref('Human')
const sandboxTitle = ref('')
const draftActors = ref<SocialStartRequest['actors']>([
  { id: 'human', ordinal: 0, control: 'human', displayName: 'Human' },
  { id: 'alice', ordinal: 1, control: 'model', displayName: 'Alice', modelRef: 'openrouter/inclusionai/ling-3.0-flash-fin:free', profile: 'Thoughtful, curious, and diplomatic.' },
  { id: 'bob', ordinal: 2, control: 'model', displayName: 'Bob', modelRef: 'openrouter/dots-studio/dots-3-note-preview:free', profile: 'Skeptical, direct, and strategic.' },
  { id: 'cleo', ordinal: 3, control: 'model', displayName: 'Cleo', modelRef: 'openrouter/nvidia/nemotron-3.5-lightning:free', profile: 'Warm, observant, and mischievous.' },
])
const groupTitle = ref('')
const selectedInvitees = ref<string[]>([])
const modelOptions = ref<Array<{ label: string; value: string }>>([
  { label: 'Ling 3.0 Flash Fin (free)', value: 'openrouter/inclusionai/ling-3.0-flash-fin:free' },
  { label: 'Dots 3 Note Preview (free)', value: 'openrouter/dots-studio/dots-3-note-preview:free' },
  { label: 'Nemotron 3.5 Lightning (free)', value: 'openrouter/nvidia/nemotron-3.5-lightning:free' },
])
const excludedModelIds = new Set(['openrouter/liquid/lfm-2.5-2.6b:free'])
const cleoFallbackModel = 'openrouter/nvidia/nemotron-3.5-lightning:free'
const composer = ref('')
const loading = ref(false)
const sending = ref(false)
const error = ref('')
const sessionActive = ref(false)
const storedSessions = ref<SocialStoredSession[]>([])
const messagesPane = ref<HTMLElement | null>(null)
let stopEvents: (() => void) | undefined
const router = useRouter()
const route = useRoute()

const selectedChannel = computed(() => channels.value.find((channel) => channel.id === selectedChannelId.value))
const aiActors = computed(() => actors.value.filter((actor) => actor.control === 'model'))
const dmChannels = computed(() => channels.value.filter((channel) => channel.kind === 'dm'))
const groupChannels = computed(() => channels.value.filter((channel) => channel.kind === 'group'))
const isHome = computed(() => !route.params.sessionId)
const activeStoredSessions = computed(() => storedSessions.value.filter((saved) => !saved.session.archived))
const archivedStoredSessions = computed(() => storedSessions.value.filter((saved) => saved.session.archived))
const inspectionEnabled = ref(false)
const inspectionAvailable = ref(false)

/** Keep persisted OpenRouter references compatible with the UI model catalog. */
function normalizeModelRef(modelRef: string | undefined): string {
  return modelRef ?? ''
}

/** Copy resumed actor assignments into the setup controls used by the next session. */
function syncModelSelections(resumedActors: SocialActor[]): void {
  draftActors.value = resumedActors.map((actor) => ({ id: actor.id, ordinal: actor.ordinal, control: actor.control, displayName: actor.displayName, ...(actor.modelRef ? { modelRef: normalizeModelRef(actor.modelRef) } : {}), ...(actor.profile ? { profile: actor.profile } : {}) }))
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

/** Stop the active workspace and return to the persisted sandbox homepage. */
async function stopAndReturnHome(): Promise<void> {
  try { await api.stopSocialSession(); sessionActive.value = false; stopEvents?.(); stopEvents = undefined; await router.push('/social'); await load() } catch (caught) { error.value = caught instanceof Error ? caught.message : 'Could not stop sandbox' }
}

/** Open a saved sandbox in its dedicated workspace route. */
function openStoredSession(sessionId: string): void {
  void router.push(`/social/chat/${encodeURIComponent(sessionId)}`)
}

/** Archive or restore a sandbox from the homepage. */
async function setArchived(saved: SocialStoredSession, archived: boolean): Promise<void> {
  try { await api.updateStoredSocialSession(saved.session.id, { archived }); await load() } catch (caught) { error.value = caught instanceof Error ? caught.message : 'Could not update sandbox' }
}

/** Rename a sandbox from its compact homepage card. */
async function renameStoredSession(saved: SocialStoredSession): Promise<void> {
  const title = window.prompt('Sandbox title', saved.session.title ?? 'Untitled sandbox')?.trim()
  if (!title) return
  try { await api.updateStoredSocialSession(saved.session.id, { title }); await load() } catch (caught) { error.value = caught instanceof Error ? caught.message : 'Could not rename sandbox' }
}

/** Permanently remove a stopped sandbox after confirmation. */
async function deleteStoredSession(saved: SocialStoredSession): Promise<void> {
  if (!window.confirm(`Delete “${saved.session.title ?? saved.session.id}” permanently?`)) return
  try { await api.deleteStoredSocialSession(saved.session.id); await load() } catch (caught) { error.value = caught instanceof Error ? caught.message : 'Could not delete sandbox' }
}

/** Refresh the session, channel list, and current transcript. */
async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    try {
      const discovered = await api.getConfigModels()
      const freeModels = discovered.models.filter((model) => model.id.endsWith(':free')).map((model) => ({ label: model.name, value: model.id })).filter((model) => !excludedModelIds.has(model.value))
      if (freeModels.length) modelOptions.value = freeModels
    } catch { /* The curated free defaults keep setup usable without discovery credentials. */ }
    storedSessions.value = (await api.getStoredSocialSessions()).sessions
    if (isHome.value) return
    let session: SocialSessionResponse
    try { session = await api.getSocialSession() } catch { session = await api.resumeSocialSession(String(route.params.sessionId)) }
    if (session.sessionId !== String(route.params.sessionId)) throw new Error('The selected sandbox is not the active sandbox')
    sessionActive.value = true
    inspectionAvailable.value = session.inspectionAvailable === true
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
  const response = await api.getSocialChannels(inspectionEnabled.value)
  channels.value = response.channels
  if (!channels.value.some((channel) => channel.id === selectedChannelId.value)) selectedChannelId.value = 'world'
  await loadMessages()
}

/** Load the selected channel transcript. */
async function loadMessages(): Promise<void> {
  if (!selectedChannelId.value) return
  try { messages.value = (await api.getSocialMessages(selectedChannelId.value, inspectionEnabled.value)).messages } catch (caught) { error.value = caught instanceof Error ? caught.message : 'Could not load messages' }
  await scrollToLatest()
}

/** Start a small local social sandbox with three model actors. */
async function start(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const response = await api.startSocialSession({ title: sandboxTitle.value.trim() || 'Untitled sandbox', actors: draftActors.value.map((actor, ordinal) => ({ ...actor, ordinal, ...(actor.id === 'human' ? { displayName: displayName.value || actor.displayName || 'Human' } : {}) })) })
    actors.value = response.actors
    sessionActive.value = true
    await loadChannels()
    connectEvents()
    void router.push(`/social/chat/${encodeURIComponent(response.sessionId)}`)
  } catch (caught) { error.value = caught instanceof Error ? caught.message : 'Could not start social session' } finally { loading.value = false }
}

/** Add a model actor to the new-sandbox roster. */
function addDraftActor(): void { const ordinal = draftActors.value.length; draftActors.value.push({ id: `actor-${crypto.randomUUID()}`, ordinal, control: 'model', displayName: `Actor ${ordinal}`, modelRef: modelOptions.value[ordinal % modelOptions.value.length]?.value ?? 'openrouter/nvidia/nemotron-3.5-lightning:free', profile: '' }) }

/** Remove a model actor from the new-sandbox roster while retaining the human seat. */
function removeDraftActor(actorId: string): void { if (draftActors.value.length <= 2 || actorId === 'human') return; draftActors.value = draftActors.value.filter((actor) => actor.id !== actorId).map((actor, ordinal) => ({ ...actor, ordinal })) }

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
    selectedChannelId.value = 'world'
    await loadChannels()
    connectEvents()
    void router.push(`/social/chat/${encodeURIComponent(sessionId)}`)
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
function connectEvents(): void { stopEvents?.(); stopEvents = api.streamSocialEvents(async () => { await loadChannels() }, inspectionEnabled.value) }

/** Toggle explicit developer inspection and reload the authorized view. */
async function toggleInspection(): Promise<void> { await loadChannels(); connectEvents() }

onMounted(async () => { await load() })
watch(() => route.params.sessionId, async (sessionId, previousSessionId) => { if (sessionId !== previousSessionId) await load() })
onUnmounted(() => stopEvents?.())
</script>

<template>
  <div class="social-page">
    <div class="page-header">
      <div><h1>Social Sandbox</h1><p class="text-muted">A persistent multi-agent conversation space for Vox Deorum.</p></div>
      <div class="flex gap-2 align-items-center"><Button v-if="!isHome" label="Sandbox home" icon="pi pi-home" text severity="secondary" @click="goToSandboxMenu" /><Tag v-if="sessionActive && !isHome" severity="success" value="Live" /><Button v-if="sessionActive && !isHome" label="Stop" icon="pi pi-stop" severity="secondary" @click="stopAndReturnHome" /></div>
    </div>
    <div v-if="error" class="social-error">{{ error }}</div>
    <div v-if="isHome" class="social-home">
      <Card class="social-start-card create-card"><template #title>New sandbox</template><template #content><p class="text-muted">Create a 2–8 participant conversation space.</p><div class="flex gap-2"><InputText v-model="sandboxTitle" placeholder="Sandbox title" /><InputText v-model="displayName" placeholder="Your display name" /><Button label="Create sandbox" icon="pi pi-plus" :loading="loading" @click="start" /></div><div class="draft-roster"><div v-for="actor in draftActors" :key="actor.id" class="draft-actor"><InputText v-model="actor.displayName" :disabled="actor.control === 'human'" placeholder="Actor name" /><Dropdown v-if="actor.control === 'model'" v-model="actor.modelRef" :options="modelOptions" option-label="label" option-value="value" /><Textarea v-if="actor.control === 'model'" v-model="actor.profile" auto-resize rows="1" placeholder="Optional profile" /><Button v-if="actor.control === 'model'" icon="pi pi-trash" text rounded severity="danger" aria-label="Remove actor" @click="removeDraftActor(actor.id)" /></div><Button label="Add model" icon="pi pi-user-plus" text size="small" :disabled="draftActors.length >= 8" @click="addDraftActor" /></div></template></Card>
      <section class="sandbox-list"><div class="list-heading"><h2>Saved chats</h2><span class="text-muted">{{ activeStoredSessions.length }}</span></div><div v-if="!activeStoredSessions.length" class="empty-home">No saved chats yet.</div><article v-for="saved in activeStoredSessions" :key="saved.session.id" class="sandbox-card"><button class="sandbox-open" @click="openStoredSession(saved.session.id)"><strong>{{ saved.session.title || 'Untitled sandbox' }}</strong><small>{{ saved.actors.filter((actor) => actor.control === 'model').map((actor) => `${actor.displayName} · ${actor.modelRef || 'unconfigured'}`).join('  |  ') }}</small><small>{{ saved.session.updatedAt || saved.session.createdAt || 'No timestamp' }}</small></button><div class="sandbox-actions"><Button icon="pi pi-pencil" text rounded aria-label="Rename chat" @click="renameStoredSession(saved)" /><Button icon="pi pi-box" text rounded aria-label="Archive chat" @click="setArchived(saved, true)" /><Button icon="pi pi-trash" text rounded severity="danger" aria-label="Delete chat" @click="deleteStoredSession(saved)" /></div></article></section>
      <section class="sandbox-list archived-list"><div class="list-heading"><h2>Archived chats</h2><span class="text-muted">{{ archivedStoredSessions.length }}</span></div><article v-for="saved in archivedStoredSessions" :key="saved.session.id" class="sandbox-card"><button class="sandbox-open" @click="openStoredSession(saved.session.id)"><strong>{{ saved.session.title || 'Untitled sandbox' }}</strong><small>{{ saved.actors.filter((actor) => actor.control === 'model').map((actor) => actor.displayName).join('  |  ') }}</small></button><div class="sandbox-actions"><Button icon="pi pi-replay" text rounded aria-label="Restore chat" @click="setArchived(saved, false)" /><Button icon="pi pi-trash" text rounded severity="danger" aria-label="Delete chat" @click="deleteStoredSession(saved)" /></div></article></section>
    </div>
    <div v-else-if="sessionActive" class="social-shell">
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
        <header class="conversation-header"><div><h2>{{ selectedChannel?.title ?? 'WORLD' }}</h2><span class="text-muted">{{ selectedChannel?.kind === 'world' ? 'Everyone in the session' : 'Private conversation' }}</span></div><div class="flex align-items-center gap-2"><label v-if="inspectionAvailable" class="text-small"><Checkbox v-model="inspectionEnabled" binary @change="toggleInspection" /> Reveal AI-private rooms</label><i class="pi pi-comments text-primary text-xl" /></div></header>
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
.social-home { width: min(100%, 980px); margin: 0 auto; overflow: auto; }.create-card { max-width: none; margin: 0 0 1.25rem; }.create-card .p-inputtext { min-width: 0; flex: 1; }.draft-roster { display: grid; gap: .5rem; margin-top: 1rem; }.draft-actor { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) auto; gap: .5rem; }.sandbox-list { margin-bottom: 1.25rem; }.list-heading { display: flex; align-items: center; gap: .5rem; margin: 1rem 0 .6rem; }.list-heading h2 { margin: 0; font-size: 1rem; }.sandbox-card { display: flex; align-items: center; gap: .75rem; padding: .7rem .85rem; margin-bottom: .45rem; border: 1px solid var(--p-content-border-color); border-radius: 7px; background: var(--p-content-background); }.sandbox-open { min-width: 0; flex: 1; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; display: grid; gap: .18rem; }.sandbox-open strong, .sandbox-open small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.sandbox-open small { color: var(--p-text-muted-color); }.sandbox-actions { display: flex; flex-shrink: 0; }.empty-home { padding: 1rem; color: var(--p-text-muted-color); border: 1px dashed var(--p-content-border-color); border-radius: 7px; }.archived-list { opacity: .86; }
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
