<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Textarea from 'primevue/textarea';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import Message from 'primevue/message';
import ProgressSpinner from 'primevue/progressspinner';
import TabView from 'primevue/tabview';
import TabPanel from 'primevue/tabpanel';
import { api } from '../api/client';
import type { SocialStatusResponse, SocialMessagesResponse, SocialSeat } from '../utils/types';

/** Per-seat pending count (messages newer than that seat's lastSeenTurn). */
interface PendingRow { seat: number; label: string; pending: number; lastSeenTurn: number; playedBy?: string }

const status = ref<SocialStatusResponse | null>(null);
const msgs = ref<SocialMessagesResponse | null>(null);
const loading = ref(false);
const mcpDown = ref(false);
const err = ref('');

const controlSeat = ref(0);
const activeTab = ref(0);

const sendChannel = ref('world');
const sendText = ref('');
const sending = ref(false);
const sendNote = ref('');

const createTitle = ref('');
const inviteGroupId = ref('');
const inviteSeat = ref('1');

const POLL_MS = 5000;
let timer: ReturnType<typeof setInterval> | null = null;

const seats = computed<SocialSeat[]>(() => status.value?.seats ?? []);
const groups = computed(() => status.value?.groups ?? []);
const activeGroups = computed(() => groups.value.filter(g => !g.archived));

const worldMessages = computed(() => msgs.value?.world ?? []);

const pendingRows = computed<PendingRow[]>(() => {
  const rows: PendingRow[] = [];
  for (const s of seats.value) {
    const lastSeen = Number(s.lastSeenTurn ?? 0);
    let pending = 0;
    for (const m of worldMessages.value) if ((m.Turn ?? 0) > lastSeen && m.SpeakerID !== s.seat) pending++;
    for (const g of msgs.value?.groups ?? []) if (g.id && g.messages) for (const m of g.messages) if ((m.Turn ?? 0) > lastSeen && m.SpeakerID !== s.seat) pending++;
    for (const d of msgs.value?.dms ?? []) if (d.seat !== s.seat) for (const m of d.messages) if ((m.Turn ?? 0) > lastSeen && m.SpeakerID !== s.seat) pending++;
    rows.push({
      seat: s.seat,
      label: s.civ || `Seat ${s.seat}`,
      pending,
      lastSeenTurn: lastSeen,
      playedBy: s.playedBy,
    });
  }
  return rows;
});

const seatOptions = computed(() => seats.value.map(s => ({ label: `${s.civ} (seat ${s.seat})`, value: s.seat })));

const dmOptions = computed(() => seats.value.filter(s => s.seat !== controlSeat.value).map(s => ({ label: `DM ${s.civ} (seat ${s.seat})`, value: `dm:${s.seat}` })));

const groupOptions = computed(() => activeGroups.value.map(g => ({ label: `Group ${g.title} (${g.id})`, value: `group:${g.id}` })));

const channelOptions = computed(() => [
  { label: 'World', value: 'world' },
  ...dmOptions.value,
  ...groupOptions.value,
]);

function fmtTime(sec?: number): string {
  if (!sec) return '';
  const d = new Date(sec * 1000);
  return d.toLocaleTimeString();
}

async function tick() {
  loading.value = true;
  err.value = '';
  try {
    const st = await api.getSocialStatus();
    status.value = st;
    mcpDown.value = !st.game;
  } catch (e: any) {
    mcpDown.value = true;
    err.value = `status: ${e?.message ?? e}`;
  }
  try {
    msgs.value = await api.getSocialMessages(controlSeat.value);
    mcpDown.value = false;
  } catch (e: any) {
    err.value = `messages: ${e?.message ?? e}`;
  }
  loading.value = false;
}

async function send() {
  const text = sendText.value.trim();
  if (!text) return;
  sending.value = true;
  sendNote.value = '';
  try {
    const r = await api.sendSocialMessage(controlSeat.value, sendChannel.value, text);
    sendNote.value = r.ok ? `sent (${r.channel ?? 'ok'})` : `failed`;
    sendText.value = '';
    await tick();
  } catch (e: any) {
    sendNote.value = `send failed: ${e?.message ?? e}`;
  } finally {
    sending.value = false;
  }
}

async function createGroup() {
  const title = createTitle.value.trim();
  if (!title) return;
  try {
    await api.sendSocialMessage(controlSeat.value, `group:create:${title}`, 'OPENS');
    createTitle.value = '';
    await tick();
  } catch (e: any) {
    sendNote.value = `create failed: ${e?.message ?? e}`;
  }
}

async function invite(gid: string) {
  const target = Number(inviteSeat.value.trim());
  if (!Number.isInteger(target)) { sendNote.value = 'invite seat must be an integer'; return; }
  try {
    await api.sendSocialMessage(controlSeat.value, `group:invite:${gid}:${target}`, 'INVITED');
    await tick();
  } catch (e: any) {
    sendNote.value = `invite failed: ${e?.message ?? e}`;
  }
}

async function resolveInvite(gid: string, accept: boolean) {
  try {
    await api.resolveGroupInvite(gid, controlSeat.value, accept);
    await tick();
  } catch (e: any) {
    sendNote.value = `invite resolve failed: ${e?.message ?? e}`;
  }
}

async function leaveGroup(gid: string) {
  try {
    await api.socialLeaveGroup(gid, controlSeat.value);
    await tick();
  } catch (e: any) {
    sendNote.value = `leave failed: ${e?.message ?? e}`;
  }
}

async function archiveGroup(gid: string) {
  try {
    await api.socialArchiveGroup(gid, controlSeat.value);
    await tick();
  } catch (e: any) {
    sendNote.value = `archive failed: ${e?.message ?? e}`;
  }
}

onMounted(() => {
  tick();
  timer = setInterval(tick, POLL_MS);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
  timer = null;
});
</script>

<template>
  <div class="social-view">
    <h2 class="social-heading">Social</h2>

    <div v-if="mcpDown" style="margin-bottom: 0.8rem">
      <Message severity="warn">MCP/game stack not reachable — the Social tab needs bridge + mcp-server (:4000) running.</Message>
    </div>
    <div v-if="err" style="margin-bottom: 0.8rem">
      <Message severity="error">{{ err }}</Message>
    </div>

    <!-- Turn order strip: game turn + per-seat lastSeenTurn + pending -->
    <div class="turn-strip">
      <Tag :value="`Turn ${status?.game?.turn ?? '—'}`" severity="info" />
      <div v-for="row in pendingRows" :key="row.seat" class="turn-seat">
        <strong>{{ row.label }}</strong>
        <Tag :value="`seen T${row.lastSeenTurn}`" severity="secondary" />
        <Tag v-if="row.pending > 0" :value="`${row.pending} pending`" severity="warn" />
        <Tag v-else value="current" severity="success" />
      </div>
    </div>

    <div class="social-layout">
      <!-- Left: control seat + channels -->
      <div class="social-side">
        <label class="field-label">Speak as seat</label>
        <Select v-model="controlSeat" :options="seatOptions" option-label="label" option-value="value" style="width: 100%" @change="tick" />
        <label class="field-label" style="margin-top: 0.8rem">Channel</label>
        <Select v-model="sendChannel" :options="channelOptions" option-label="label" option-value="value" style="width: 100%" />
        <label class="field-label" style="margin-top: 0.8rem">Message</label>
        <Textarea v-model="sendText" rows="3" style="width: 100%" placeholder="Letters to the world, a DM, or a group..." />
        <Button label="Send" icon="pi pi-send" :loading="sending" style="margin-top: 0.5rem" @click="send" />
        <div v-if="sendNote" class="send-note">{{ sendNote }}</div>

        <div class="group-tools">
          <h4>Groups</h4>
          <div class="group-create">
            <InputText v-model="createTitle" placeholder="New group title" style="flex: 1" />
            <Button label="Create" icon="pi pi-plus" text @click="createGroup" />
          </div>
          <div class="group-invite" v-if="activeGroups.length">
            <Select v-model="inviteGroupId" :options="activeGroups.map(g => ({ label: g.title, value: g.id }))" option-label="label" option-value="value" placeholder="Group" style="flex: 1" />
            <InputText v-model.number="inviteSeat" type="number" placeholder="seat" style="width: 5rem" />
            <Button label="Invite" icon="pi pi-user-plus" text @click="invite(inviteGroupId)" />
          </div>
        </div>
      </div>

      <!-- Right: tabs -->
      <div class="social-main">
        <TabView v-model:value="activeTab">
          <TabPanel value="world" header="World">
            <div v-if="!msgs" class="empty">Loading world channel...</div>
            <div v-else-if="!worldMessages.length" class="empty">No world messages yet.</div>
            <div v-else class="chat-feed">
              <div v-for="m in [...worldMessages].reverse()" :key="m.ID" class="chat-row">
                <span class="chat-meta">T{{ m.Turn }} · {{ m.speaker }} · {{ fmtTime(m.CreatedAt) }}</span>
                <div class="chat-body">{{ m.Content }}</div>
              </div>
            </div>
          </TabPanel>

          <TabPanel value="groups" header="Groups">
            <div v-if="!msgs?.groups.length" class="empty">No groups yet — create one on the left.</div>
            <div v-else class="group-list">
              <div v-for="g in msgs?.groups" :key="g.id" class="group-card">
                <div class="group-head">
                  <strong>{{ g.title }}</strong>
                  <Tag :value="g.id" severity="secondary" />
                  <Tag :value="g.myStatus" :severity="g.myStatus === 'active' ? 'success' : 'warn'" />
                  <span class="group-members">
                    <Tag v-for="m in g.members.filter(x => x.status !== 'declined')" :key="m.seat" :value="`seat ${m.seat}:${m.status}`" severity="secondary" />
                  </span>
                </div>
                <div v-if="g.myStatus === 'invited'" class="invite-actions">
                  <Button label="Accept" icon="pi pi-check" size="small" @click="resolveInvite(g.id, true)" />
                  <Button label="Decline" icon="pi pi-times" size="small" severity="secondary" @click="resolveInvite(g.id, false)" />
                </div>
                <div v-else>
                  <div v-if="!g.messages.length" class="empty">No new messages in this group.</div>
                  <div v-else class="chat-feed">
                    <div v-for="m in [...g.messages].reverse()" :key="m.ID" class="chat-row">
                      <span class="chat-meta">T{{ m.Turn }} · {{ m.speaker }} · {{ fmtTime(m.CreatedAt) }}</span>
                      <div class="chat-body">{{ m.body }}</div>
                    </div>
                  </div>
                  <div class="group-actions">
                    <Button label="Leave" icon="pi pi-sign-out" size="small" severity="secondary" @click="leaveGroup(g.id)" />
                    <Button v-if="g.myStatus === 'active'" label="Archive" icon="pi pi-archive" size="small" severity="danger" outlined @click="archiveGroup(g.id)" />
                  </div>
                </div>
              </div>
            </div>
          </TabPanel>

          <TabPanel value="dms" header="DMs">
            <div v-if="!msgs?.dms.length" class="empty">No DM threads yet. Pick channel "DM ..." on the left to start one.</div>
            <div v-else class="group-list">
              <div v-for="d in msgs?.dms" :key="d.seat" class="group-card">
                <div class="group-head">
                  <strong>{{ d.civ }} (seat {{ d.seat }})</strong>
                  <span class="group-members"><Tag :value="d.leader" severity="secondary" /></span>
                </div>
                <div v-if="!d.messages.length" class="empty">No new private letters.</div>
                <div v-else class="chat-feed">
                  <div v-for="m in [...d.messages].reverse()" :key="m.ID" class="chat-row">
                    <span class="chat-meta">T{{ m.Turn }} · {{ m.speaker }} · {{ m.MessageType ?? 'text' }}</span>
                    <div class="chat-body">{{ m.Content }}</div>
                  </div>
                </div>
              </div>
            </div>
          </TabPanel>
        </TabView>
      </div>
    </div>
  </div>
</template>

<style scoped>
.social-view { padding: 1rem; max-width: 1100px; margin: 0 auto; }
.social-heading { margin-top: 0; }
.turn-strip { display: flex; flex-wrap: wrap; gap: 0.8rem; align-items: center; padding: 0.8rem; border: 1px solid var(--p-surface-200, #ddd); border-radius: 8px; margin-bottom: 1rem; }
.turn-seat { display: flex; gap: 0.4rem; align-items: center; }
.social-layout { display: flex; gap: 1rem; align-items: flex-start; }
.social-side { flex: 0 0 300px; display: flex; flex-direction: column; }
.social-main { flex: 1; min-width: 0; }
.field-label { font-size: 0.85rem; color: var(--p-text-secondary, #666); margin-bottom: 0.2rem; }
.send-note { font-size: 0.8rem; margin-top: 0.3rem; color: var(--p-text-secondary, #666); }
.group-tools { margin-top: 1rem; padding: 0.6rem; border: 1px solid var(--p-surface-200, #ddd); border-radius: 8px; }
.group-tools h4 { margin: 0 0 0.5rem; }
.group-create, .group-invite { display: flex; gap: 0.4rem; margin-bottom: 0.5rem; align-items: center; }
.chat-feed { max-height: 52vh; overflow-y: auto; display: flex; flex-direction: column; gap: 0.4rem; }
.chat-row { border: 1px solid var(--p-surface-200, #e5e7eb); border-radius: 6px; padding: 0.4rem 0.6rem; }
.chat-meta { font-size: 0.72rem; color: var(--p-text-secondary, #888); }
.chat-body { white-space: pre-wrap; word-break: break-word; }
.empty { color: var(--p-text-secondary, #888); font-style: italic; padding: 0.6rem 0; }
.group-list { display: flex; flex-direction: column; gap: 0.7rem; }
.group-card { border: 1px solid var(--p-surface-200, #e5e7eb); border-radius: 8px; padding: 0.6rem; }
.group-head { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.4rem; }
.group-members { display: flex; gap: 0.3rem; flex-wrap: wrap; }
.group-actions, .invite-actions { display: flex; gap: 0.4rem; margin-top: 0.5rem; }
</style>
