import { MSE, VizEngine, VPlaylist, VProfile, VRundown, VShow } from './v-connection'
import { getPepErrorMessage, LocationType, PepResponse, PepTalkClient, PepTalkJS, startPepTalk } from './peptalk'
import { CommandResult, IHTTPRequestError } from './msehttp'
import { EventEmitter } from 'events'
import { AtomEntry, FlatEntry, flattenEntry } from './xml'
import { Rundown } from './rundown'
import * as uuid from 'uuid'
import { wrapInBracesIfNeeded } from './util'

const UUID_RE = /[a-fA-f0-9]{8}-[a-fA-f0-9]{4}-[a-fA-f0-9]{4}-[a-fA-f0-9]{4}-[a-fA-f0-9]{12}/
export const CREATOR_NAME = 'Sofie'

export class MSERep extends EventEmitter implements MSE {
	readonly hostname: string
	readonly resthost?: string
	readonly restPort: number
	readonly wsPort: number

	private pep: PepTalkClient & PepTalkJS
	private connection?: Promise<PepResponse> = undefined

	private reconnectTimeout?: NodeJS.Timeout = undefined
	private lastConnectionAttempt?: number = undefined

	constructor(hostname: string, restPort?: number, wsPort?: number, resthost?: string) {
		super()
		this.hostname = hostname
		this.restPort = typeof restPort === 'number' && restPort > 0 ? restPort : 8580
		this.wsPort = typeof wsPort === 'number' && wsPort > 0 ? wsPort : 8595
		this.resthost = resthost // For ngrok testing only
		this.pep = this.initPep()
	}

	initPep(): PepTalkClient & PepTalkJS {
		if (this.pep) {
			this.pep.removeAllListeners()
		}
		const pep = startPepTalk(this.hostname, this.wsPort)
		pep.on('close', () => this.onPepClose())
		this.lastConnectionAttempt = Date.now()
		this.connection = pep.connect().catch((e) => e)
		return pep
	}

	onPepClose(): void {
		if (!this.reconnectTimeout) {
			this.connection = undefined
			this.reconnectTimeout = setTimeout(() => {
				this.reconnectTimeout = undefined
				this.pep = this.initPep()
			}, Math.max(2000 - (Date.now() - (this.lastConnectionAttempt ?? 0)), 0))
		}
	}

	async checkConnection(): Promise<void> {
		if (this.connection) {
			await this.connection
		} else {
			throw new Error('Attempt to connect to PepTalk server failed.')
		}
	}

	getPep(): PepTalkClient & PepTalkJS {
		return this.pep
	}

	// private readonly sofieShowRE = /<entry name="sofie_show">\/storage\/shows\/\{([^\}]*)\}<\/entry>/

	async getRundowns(): Promise<VRundown[]> {
		await this.checkConnection()
		const playlistList = await this.pep.getJS('/storage/playlists', 3)
		const atomEntry: any = playlistList.js as AtomEntry
		// Horrible hack ... playlists not following atom pub model
		if (atomEntry.entry) {
			atomEntry.entry.entry = atomEntry.entry.playlist
			delete atomEntry.entry.playlist
		}
		const flatList = await flattenEntry(playlistList.js as AtomEntry)
		return Object.keys(flatList)
			.filter((k) => k !== 'name' && typeof flatList[k] !== 'string' && (flatList[k] as FlatEntry).sofie_show)
			.map(
				(k) =>
					new Rundown(
						this,
						(flatList[k] as FlatEntry).profile as string,
						k,
						(flatList[k] as FlatEntry).description as string
					)
			)
	}

	async getRundown(playlistID: string): Promise<VRundown> {
		const playlist = await this.getPlaylist(playlistID)
		return new Rundown(this, playlist.profile, playlistID, playlist.description as string)
	}

	async getEngines(): Promise<VizEngine[]> {
		await this.checkConnection()
		const handlers = await this.pep.getJS('/scheduler')
		const handlersBody = handlers.js as any
		// Sometimes the main node is is called 'scheduler', sometimes 'entry'
		// It doesn't seem to depend on specific version, so let's just support both
		const vizEntries: AtomEntry[] = (handlersBody.entry || handlersBody.scheduler).handler.filter(
			(x: any) => x.$.type === 'viz'
		)
		const viz = await Promise.all(vizEntries.map(async (x) => flattenEntry(x)))
		return viz as VizEngine[]
	}

	async listProfiles(): Promise<string[]> {
		await this.checkConnection()
		const profileList = await this.pep.getJS('/config/profiles', 1)
		const flatList = await flattenEntry(profileList.js as AtomEntry)
		return Object.keys(flatList).filter((x: string) => x !== 'name')
	}

	async getProfile(profileName: string): Promise<VProfile> {
		await this.checkConnection()
		const profile = await this.pep.getJS(`/config/profiles/${profileName}`)
		const flatProfile = await flattenEntry(profile.js as AtomEntry)
		return flatProfile as VProfile
	}

	async listShows(): Promise<string[]> {
		await this.checkConnection()
		const showList = await this.pep.getJS('/storage/shows', 1)
		const flatList = await flattenEntry(showList.js as AtomEntry)
		return Object.keys(flatList).filter((x: string) => x !== 'name')
	}

	async getShow(showId: string): Promise<VShow> {
		showId = wrapInBracesIfNeeded(showId)
		if (!UUID_RE.exec(showId)) {
			return Promise.reject(new Error(`Show id must be a UUID and '${showId}' is not.`))
		}
		await this.checkConnection()
		const show = await this.pep.getJS(`/storage/shows/${showId}`)
		const flatShow = await flattenEntry(show.js as AtomEntry)
		return flatShow as VShow
	}

	async listPlaylists(): Promise<string[]> {
		await this.checkConnection()
		const playlistList = await this.pep.getJS('/storage/playlists', 1)
		const atomEntry: any = playlistList.js as AtomEntry
		// Horrible hack ... playlists not following atom pub model
		if (atomEntry.entry) {
			atomEntry.entry.entry = atomEntry.entry.playlist
			delete atomEntry.entry.playlist
		}
		const flatList = await flattenEntry(playlistList.js as AtomEntry)
		return Object.keys(flatList).filter((x: string) => x !== 'name')
	}

	async getPlaylist(playlistName: string): Promise<VPlaylist> {
		playlistName = wrapInBracesIfNeeded(playlistName)
		if (!UUID_RE.exec(playlistName)) {
			return Promise.reject(new Error(`Playlist name must be a UUID and '${playlistName}' is not.`))
		}
		await this.checkConnection()
		const playlist = await this.pep.getJS(`/storage/playlists/${playlistName}`)
		let flatPlaylist = await flattenEntry(playlist.js as AtomEntry)
		if (Object.keys(flatPlaylist).length === 1) {
			flatPlaylist = flatPlaylist[Object.keys(flatPlaylist)[0]] as FlatEntry
		}
		return flatPlaylist as VPlaylist
	}

	// Rundown basics task
	async createRundown(profileName: string, playlistID?: string, description?: string): Promise<VRundown> {
		let playlistExists = false
		const date = new Date()
		description = description ? description : `Sofie Rundown ${date.toISOString()}`
		try {
			await this.pep.get(`/config/profiles/${profileName}`, 1)
		} catch (err) {
			throw new Error(
				`The profile with name '${profileName}' for a new rundown does not exist. Error is: ${getPepErrorMessage(err)}.`
			)
		}
		if (playlistID) {
			try {
				const playlist = await this.getPlaylist(playlistID.toUpperCase())
				if (!playlist.profile.endsWith(`/${profileName}`)) {
					throw new Error(
						`Referenced playlist exists but references profile '${playlist.profile}' rather than the given '${profileName}'.`
					)
				}
				playlistExists = true
			} catch (err) {
				if (getPepErrorMessage(err).startsWith('Referenced playlist exists but')) {
					throw err
				}
				playlistExists = false
			}
		}
		if (!playlistExists) {
			playlistID = playlistID && UUID_RE.exec(playlistID) ? playlistID.toUpperCase() : uuid.v4().toUpperCase()
			const modifiedDate = `${date.getUTCDate().toString().padStart(2, '0')}.${(date.getUTCMonth() + 1)
				.toString()
				.padStart(2, '0')}.${date.getFullYear()} ${date.getHours().toString().padStart(2, '0')}:${date
				.getMinutes()
				.toString()
				.padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`
			await this.pep.insert(
				`/storage/playlists/{${playlistID}}`,
				`<playlist description="${description}" modified="${modifiedDate}" profile="/config/profiles/${profileName}" name="{${playlistID}}">
    <elements/>
    <entry name="environment">
        <entry name="alternative_concept"/>
    </entry>
    <entry name="cursors">
        <entry name="globals">
            <entry name="last_taken"/>
            <entry name="last_read"/>
        </entry>
    </entry>
    <entry backing="transient" name="active_profile"/>
    <entry name="meta"/>
    <entry name="settings"/>
    <entry name="ncs_cursor"/>
</playlist>`,
				LocationType.Last
			)
		}
		return new Rundown(this, profileName, playlistID as string, description)
	}

	// Rundown basics task
	async deleteRundown(rundown: VRundown): Promise<boolean> {
		const playlist = await this.getPlaylist(rundown.playlist)
		// console.dir(playlist, { depth: 10 })
		if (playlist.active_profile.value) {
			throw new Error(`Cannot delete an active profile.`)
		}
		const delres = await this.pep.delete(`/storage/playlists/{${rundown.playlist}}`)
		return delres.status === 'ok'
	}

	// Advanced feature
	async createProfile(_profileName: string, _profileDetailsTbc: unknown): Promise<VProfile> {
		return Promise.reject(new Error('Not implemented. Creating profiles is a future feature.'))
	}

	// Advanced feature
	async deleteProfile(_profileName: string): Promise<boolean> {
		return Promise.reject(new Error('Not implemented. Deleting profiles ia a future feature.'))
	}

	async ping(): Promise<CommandResult> {
		try {
			const res = await this.pep.ping()
			return { path: 'ping', status: 200, response: res.body }
		} catch (err: any) {
			err.path = 'ping'
			err.status = 418
			err.response = getPepErrorMessage(err)
			throw err as IHTTPRequestError
		}
	}

	async close(): Promise<boolean> {
		if (this.reconnectTimeout) {
			clearTimeout(this.reconnectTimeout)
		}
		if (this.connection) {
			await this.pep.close()
			return true
		}
		return false
	}

	private timeoutMS = 3000
	timeout(t?: number): number {
		if (typeof t !== 'number') return this.timeoutMS
		return this.pep.setTimeout(t)
	}
}

/**
 *  Factory to create an [[MSE]] instance to manage commumication between a Node
 *  application and a Viz Media Sequencer Engine.
 *  @param hostname Hostname or IP address for the instance of the MSE to control.
 *  @param restPort Optional port number for HTTP traffic, is different from the
 *                  default of 8580.
 *  @param wsPort   Optional port number for PepTalk traffic over websockets, if
 *                  different from the default of 8695.
 *  @param resthost Optional different host name for rest connection - for testing
 *                  purposes only.
 *  @return New MSE that will start to initialize a connection based on the parameters.
 */
export function createMSE(hostname: string, restPort?: number, wsPort?: number, resthost?: string): MSE {
	return new MSERep(hostname, restPort, wsPort, resthost)
}

// let sleep = (t: number) => new Promise((resolve, _reject) => {
// 	setTimeout(resolve, t)
// })
//
// async function run () {
// 	let mse = createMSE('mse_ws.ngrok.io', 80, 80, 'mse_http.ngrok.io')
// 	let rundown = await mse.createRundown('66E45216-9476-4BDC-9556-C3DB487ED9DF', 'SOFIE')
// 	await rundown.createElement(2552305, 'FULL1')
// 	try { await rundown.activate() } catch (err) { /* */ }
// 	await sleep(5000)
// 	console.log('Taking now')
// 	rundown.take(2552305)
// 	await rundown.createElement(2565133, 'FULL1')
// 	await sleep(3000)
// 	rundown.take(2565133)
// 	await mse.close()
// 	// console.log('After close.')
// }
//
// run().catch(console.error)
