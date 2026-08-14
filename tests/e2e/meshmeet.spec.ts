import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

async function newContext(browser: Browser): Promise<BrowserContext> {
	const context = await browser.newContext({ permissions: ['microphone'] });
	return context;
}

async function createRoom(page: Page, name: string): Promise<string> {
	await page.goto('/?e2e=1');
	await page.getByTestId('display-name').fill(name);
	await page.getByTestId('create-room').click();
	await expect(page).toHaveURL(/\/room\/[A-Za-z0-9_-]{22}\?e2e=1#[A-Za-z0-9_-]{43}$/);
	const invitation = page.url();
	await joinPreflight(page);
	return invitation;
}

async function joinInvite(page: Page, name: string, invitation: string): Promise<void> {
	await page.goto('/?e2e=1');
	await page.getByTestId('display-name').fill(name);
	await page.getByTestId('invite-link').fill(invitation);
	await page.getByTestId('join-invite').click();
	await joinPreflight(page);
}

async function openInvite(page: Page, name: string, invitation: string): Promise<void> {
	await page.goto(invitation);
	await expect(page.getByTestId('room-display-name')).toBeVisible();
	await page.getByTestId('room-display-name').fill(name);
	await joinPreflight(page);
}

async function joinPreflight(page: Page): Promise<void> {
	await page.getByTestId('prepare-microphone').click();
	await expect(page.getByTestId('microphone-device')).toBeVisible();
	await page.getByTestId('join-meeting').click();
	await expect(page.getByTestId('participant-list')).toBeVisible();
}

test('creates a room, connects two contexts, exchanges ephemeral chat, mutes, leaves, and clears chat', async ({
	browser
}) => {
	const hostContext = await newContext(browser);
	const guestContext = await newContext(browser);
	const host = await hostContext.newPage();
	const guest = await guestContext.newPage();

	const invitation = await createRoom(host, 'Ada');
	await openInvite(guest, 'Grace', invitation);

	await expect(host.getByTestId('participant-item')).toHaveCount(2);
	await expect(guest.getByTestId('participant-item')).toHaveCount(2);
	await expect(host.getByText('Connected', { exact: true })).toBeVisible({ timeout: 15_000 });
	await expect(host.locator('audio[data-peer-audio]')).toHaveCount(1);

	const muteButton = host.getByTestId('toggle-mute');
	await expect(muteButton).toHaveText('Mute');
	await muteButton.click();
	await expect(muteButton).toHaveText('Unmute');
	await muteButton.click();
	await expect(muteButton).toHaveText('Mute');

	await host.getByTestId('toggle-chat').click();
	await guest.getByTestId('toggle-chat').click();
	await host.getByTestId('chat-input').fill('This message only crossed the data channel.');
	await host.getByTestId('send-chat').click();
	await expect(guest.getByTestId('chat-messages')).toContainText(
		'This message only crossed the data channel.'
	);

	await host.getByTestId('chat-input').fill('Local memory only');
	await host.getByTestId('send-chat').click();
	await expect(host.getByTestId('chat-messages')).toContainText('Local memory only');
	await host.reload();
	await expect(host.getByTestId('participant-list')).toBeVisible();
	await expect(host.getByTestId('participant-item')).toHaveCount(2);
	await expect(host.getByText('Connected', { exact: true })).toBeVisible({ timeout: 15_000 });
	await expect(guest.getByTestId('participant-item')).toHaveCount(2);
	await host.getByTestId('toggle-chat').click();
	await expect(host.getByTestId('chat-messages').locator('article')).toHaveCount(0);
	await expect(host.getByTestId('chat-messages')).not.toContainText('Local memory only');

	await guest.getByTestId('leave-room').click();
	await expect(guest).toHaveURL(/\/$/);
	await expect(host.getByTestId('participant-item')).toHaveCount(1);

	await hostContext.close();
	await guestContext.close();
});

test('defaults screen sharing to 1080p and exposes higher quality choices', async ({ page }) => {
	await createRoom(page, 'Ada');
	const quality = page.getByTestId('screen-quality');
	await expect(quality).toHaveValue('1080p');
	await expect(quality.locator('option')).toHaveText(['720p', '1080p', '1440p', '4K']);
});

test('shows a minimal not-found page for invalid routes', async ({ page }) => {
	await page.goto('/not-a-room');
	await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Back home' })).toBeVisible();
});

test('rejects a fifth participant', async ({ browser }) => {
	const contexts: BrowserContext[] = [];
	try {
		const hostContext = await newContext(browser);
		contexts.push(hostContext);
		const host = await hostContext.newPage();
		const invitation = await createRoom(host, 'Host');

		for (const name of ['Two', 'Three', 'Four']) {
			const context = await newContext(browser);
			contexts.push(context);
			await joinInvite(await context.newPage(), name, invitation);
		}
		await expect(host.getByTestId('participant-item')).toHaveCount(4);
		await host.reload();
		await expect(host.getByTestId('participant-item')).toHaveCount(4);

		const fifthContext = await newContext(browser);
		contexts.push(fifthContext);
		const fifth = await fifthContext.newPage();
		await fifth.goto('/?e2e=1');
		await fifth.getByTestId('display-name').fill('Five');
		await fifth.getByTestId('invite-link').fill(invitation);
		await fifth.getByTestId('join-invite').click();
		await fifth.getByTestId('prepare-microphone').click();
		await fifth.getByTestId('join-meeting').click();
		await expect(fifth.getByTestId('room-error')).toContainText('room is full', {
			ignoreCase: true
		});
		await expect(fifth.getByTestId('join-meeting')).toBeVisible();
	} finally {
		await Promise.all(contexts.map((context) => context.close()));
	}
});
