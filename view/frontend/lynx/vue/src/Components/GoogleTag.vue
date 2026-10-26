<script setup lang="ts">
import { onMounted, onUnmounted, useAttrs, computed } from 'vue'
import { useAnalyticsStore } from 'OOCS_LynxTheme/stores/global/analyticsStore'

/**
 * Google Analytics 4 for the storefront
 */

// Nodes carry data-lynx-id/label for the page builder; with no root element they go on the preview placeholder
defineOptions({ inheritAttrs: false })
const attrs = useAttrs()

const props = withDefaults(defineProps<Lynx.GoogleTag>(), {
    ga4_id: '',
    load: 'interaction',
    delay: 10,
    consent_cookies: '',
    event_page_view: true,
    event_purchase: true,
    event_view_item_list: true,
    event_view_item: true,
    event_add_to_cart: true,
    event_view_cart: true,
    event_begin_checkout: true,
    event_add_shipping_info: true,
    event_add_payment_info: true,
})

declare global {
    interface Window {
        dataLayer?: unknown[]
        gtag?: (...args: unknown[]) => void
    }
}

const INTERACTION_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'scroll'] as const
/** Events on the bus GA4 can receive, each sent when its event_<name> setting is on. */
const GA4_EVENTS = [
    'page_view',
    'purchase',
    'view_item_list',
    'view_item',
    'add_to_cart',
    'view_cart',
    'begin_checkout',
    'add_shipping_info',
    'add_payment_info',
] as const

const analytics = useAnalyticsStore()
// The page builder previews the storefront in an iframe under /lynx_pagebuilder/
const inPreview = () =>
    typeof window !== 'undefined' &&
    (window.location.pathname.includes('/lynx_pagebuilder/') || window.parent !== window)

// Module level: one runtime per page however many nodes a design carries
let instances = 0
let runtime: { stop: () => void } | null = null
let configured = false
let scriptRequested = false

function gtag(...args: unknown[]) {
    window.gtag!(...args)
}

const enabledEvents = computed<string[]>(() => GA4_EVENTS.filter(name => props[`event_${name}`]))

function sendToGa4(event: string, params: Record<string, unknown>) {
    if (!enabledEvents.value.includes(event)) return
    gtag('event', event, params)
}

// ── Loader ───────────────────────────────────────────────────────────────────

// Computed, not read once: in the editor's preview the node keeps its instance while the setting is edited
const cookieNames = computed(() =>
    props.consent_cookies
        .split(/\r?\n/)
        .map(name => name.trim())
        .filter(Boolean)
)

/** Every cookie the admin named is present with a value; trivially true with none named. */
function consentGiven(): boolean {
    if (!cookieNames.value.length) return true
    const present = new Set(
        document.cookie
            .split(';')
            .map(part => part.trim())
            .filter(part => part.includes('=') && !part.endsWith('='))
            .map(part => part.slice(0, part.indexOf('=')))
    )
    return cookieNames.value.every(name => present.has(name))
}

/** Fetches gtag.js once consent allows; called by whichever trigger the settings arm. */
function loadScript() {
    if (scriptRequested || !consentGiven()) return
    scriptRequested = true
    const script = document.createElement('script')
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(props.ga4_id)
    script.async = true
    document.head.appendChild(script)
    for (const name of INTERACTION_EVENTS) document.removeEventListener(name, loadScript)
}

/** Decides when loadScript() runs, per the `load` setting: now, on the first interaction, or after the delay. */
function scheduleScriptLoad() {
    // The listeners stay on until the script is in: with a cookie gate
    for (const name of INTERACTION_EVENTS) document.addEventListener(name, loadScript, { passive: true })
    if (props.load === 'immediate') loadScript()
    // 'delay' waits this long; 'interaction' uses it as the fallback for a visitor who never interacts
    else if (props.delay > 0) setTimeout(loadScript, props.delay * 1000)
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

/** Brings the runtime up on this node; the returned stop() takes exactly it down again. */
function install(): { stop: () => void } {
    if (!configured) {
        configured = true
        window.dataLayer ||= []
        // The official snippet: an Arguments object per call, which is what gtag.js reads.
        window.gtag ||= function () {
            window.dataLayer!.push(arguments)
        }
        gtag('js', new Date())
        // anonymize_ip as Magento_GoogleGtag sends it
        gtag('config', props.ga4_id, {
            send_page_view: false,
            anonymize_ip: true,
        })
    }

    // Buffered events (the first page_view fires before this node mounts) come in now.
    analytics.addTracker(sendToGa4)
    scheduleScriptLoad()

    return {
        stop() {
            analytics.removeTracker(sendToGa4)
            for (const name of INTERACTION_EVENTS) document.removeEventListener(name, loadScript)
        },
    }
}

onMounted(() => {
    if (inPreview() || !props.ga4_id) return
    if (instances++ === 0) runtime = install()
})

onUnmounted(() => {
    if (inPreview() || !props.ga4_id) return
    if (--instances === 0) {
        runtime?.stop()
        runtime = null
    }
})
</script>

<template>
    <div
        v-if="inPreview()"
        :data-lynx-id="attrs['data-lynx-id']"
        :data-lynx-label="attrs['data-lynx-label']"
        class="rounded-box border-(length:--border) border-dashed border-base-300 px-3 py-2 text-sm text-base-content/70"
    >
        Google Analytics 4 · {{ props.ga4_id || 'not configured in Sales > Google API' }} · loads: {{ props.load
        }}<template v-if="props.load !== 'immediate'"> ({{ props.delay }}s)</template> · events:
        {{ enabledEvents.length }}/{{ GA4_EVENTS.length }}
    </div>
</template>
