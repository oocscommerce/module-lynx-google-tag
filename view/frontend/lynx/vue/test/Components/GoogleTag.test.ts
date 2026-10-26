import { afterEach, describe, expect, it, vi } from 'vitest'

const props = {
    event_add_payment_info: true,
    event_add_shipping_info: true,
    event_add_to_cart: true,
    event_begin_checkout: true,
    event_page_view: true,
    event_purchase: true,
    event_view_cart: true,
    event_view_item: true,
    event_view_item_list: true,
    ga4_id: 'G-TEST123',
    load: 'interaction',
    delay: 10,
    consent_cookies: '',
}
const GTAG_URL = 'https://www.googletagmanager.com/gtag/js?id=G-TEST123'

// Unmounted after each test, which takes the interaction listeners off the document
const mounted: { unmount: () => void }[] = []

// The runtime is module level (one per page): every test loads a fresh copy
async function load() {
    vi.resetModules()
    const test = await import('@oocs/module-lynx-theme/test')
    const mountNode: typeof test.mountNode = (component, options) => {
        const wrapper = test.mountNode(component, options)
        mounted.push(wrapper)
        return wrapper
    }
    const { hydrate } = test
    const { default: GoogleTag } = await import('OOCS_LynxGoogleTag/Components/GoogleTag.vue')
    const { useAnalyticsStore } = await import('OOCS_LynxTheme/stores/global/analyticsStore')
    // gtag.js is never fetched: the script element is kept instead of added to the head
    const scripts: string[] = []
    vi.spyOn(document.head, 'appendChild').mockImplementation(node => {
        scripts.push((node as HTMLScriptElement).src)
        return node
    })
    return { mountNode, hydrate, GoogleTag, useAnalyticsStore, scripts }
}

/** What reached gtag, each call as an array. */
const calls = () => (window.dataLayer ?? []).map(entry => Array.from(entry as ArrayLike<unknown>))
const events = () => calls().filter(call => call[0] === 'event')

describe('GoogleTag', () => {
    afterEach(() => {
        for (const wrapper of mounted.splice(0)) wrapper.unmount()
        delete window.dataLayer
        delete window.gtag
        window.history.replaceState({}, '', '/')
    })

    it('renders nothing on the storefront', async () => {
        const { mountNode, GoogleTag } = await load()

        expect(mountNode(GoogleTag, { props }).find('div').exists()).toBe(false)
    })

    it('configures gtag without a page view of its own', async () => {
        const { mountNode, GoogleTag } = await load()
        mountNode(GoogleTag, { props })

        expect(calls()[0][0]).toBe('js')
        expect(calls()[1]).toEqual(['config', 'G-TEST123', { send_page_view: false, anonymize_ip: true }])
    })

    it('forwards the events of the analytics bus to GA4', async () => {
        const { mountNode, GoogleTag, useAnalyticsStore } = await load()
        mountNode(GoogleTag, { props })
        const analytics = useAnalyticsStore()

        analytics.track('page_view', { page_location: 'https://shop.test/' })
        analytics.track('add_to_cart', { currency: 'USD', value: 34, items: [{ item_id: 'MJ01' }] })
        analytics.track('newsletter_signup', {})

        expect(events()).toEqual([
            ['event', 'page_view', { page_location: 'https://shop.test/' }],
            ['event', 'add_to_cart', { currency: 'USD', value: 34, items: [{ item_id: 'MJ01' }] }],
        ])
    })

    it('skips the events switched off', async () => {
        const { mountNode, GoogleTag, useAnalyticsStore } = await load()
        mountNode(GoogleTag, { props: { ...props, event_add_to_cart: false } })
        const analytics = useAnalyticsStore()

        analytics.track('page_view', {})
        analytics.track('add_to_cart', { value: 34 })

        expect(events().map(call => call[1])).toEqual(['page_view'])
    })

    it('stops forwarding once unmounted', async () => {
        const { mountNode, GoogleTag, useAnalyticsStore } = await load()
        mountNode(GoogleTag, { props })
        const analytics = useAnalyticsStore()

        mounted.pop()?.unmount()
        analytics.track('view_cart', {})

        expect(events()).toEqual([])
    })

    it('does nothing without a measurement id', async () => {
        const { mountNode, GoogleTag, scripts } = await load()
        mountNode(GoogleTag, { props: { ...props, ga4_id: '', load: 'immediate' } })

        expect(window.gtag).toBeUndefined()
        expect(scripts).toEqual([])
    })

    it('loads gtag.js on the first interaction', async () => {
        const { mountNode, GoogleTag, scripts } = await load()
        mountNode(GoogleTag, { props })
        expect(scripts).toEqual([])

        document.dispatchEvent(new Event('pointerdown'))
        document.dispatchEvent(new Event('keydown'))

        expect(scripts).toEqual([GTAG_URL])
    })

    it('loads gtag.js after the delay when nobody interacts', async () => {
        vi.useFakeTimers()
        const { mountNode, GoogleTag, scripts } = await load()
        mountNode(GoogleTag, { props: { ...props, load: 'delay', delay: 5 } })

        vi.advanceTimersByTime(4999)
        expect(scripts).toEqual([])

        vi.advanceTimersByTime(1)
        expect(scripts).toEqual([GTAG_URL])
    })

    it('loads gtag.js at once when set to immediate', async () => {
        const { mountNode, GoogleTag, scripts } = await load()
        mountNode(GoogleTag, { props: { ...props, load: 'immediate' } })

        expect(scripts).toEqual([GTAG_URL])
    })

    it('waits for every consent cookie before loading gtag.js', async () => {
        const { mountNode, GoogleTag, scripts } = await load()
        mountNode(GoogleTag, {
            props: { ...props, load: 'immediate', consent_cookies: 'cookie_consent\r\nga_allowed\n' },
        })
        expect(scripts).toEqual([])

        document.cookie = 'cookie_consent=1; path=/'
        document.cookie = 'ga_allowed=; path=/'
        document.dispatchEvent(new Event('pointerdown'))
        expect(scripts).toEqual([])

        document.cookie = 'ga_allowed=yes; path=/'
        document.dispatchEvent(new Event('pointerdown'))
        expect(scripts).toEqual([GTAG_URL])
    })

    it('shows a summary in the page builder preview, and sends nothing', async () => {
        window.history.replaceState({}, '', '/lynx_pagebuilder/preview/index/')
        const { mountNode, GoogleTag, scripts } = await load()
        const wrapper = mountNode(GoogleTag, {
            props: { ...props, event_purchase: false, 'data-lynx-id': 'n1', 'data-lynx-label': 'Google Tag' },
        })

        const summary = wrapper.find('[data-lynx-id="n1"]')
        expect(summary.attributes('data-lynx-label')).toBe('Google Tag')
        expect(summary.text()).toContain('G-TEST123')
        expect(summary.text()).toContain('loads: interaction (10s)')
        expect(summary.text()).toContain('events: 8/9')
        expect(window.gtag).toBeUndefined()
        expect(scripts).toEqual([])
    })

    it('server-renders and hydrates the same markup', async () => {
        const { hydrate, GoogleTag } = await load()
        const { html, warnings } = await hydrate(GoogleTag, { props })

        expect(html).not.toContain('Google Analytics')
        expect(warnings).toEqual([])
    })
})
