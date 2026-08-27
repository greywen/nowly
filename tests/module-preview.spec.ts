import { expect, test } from '@playwright/test';

// End-to-end check of the module preview workbench (channel B). It loads the
// standalone preview page, confirms the bundled example draft renders inside the
// sandbox iframe, that the size switcher resizes the frame, and that the lint
// panel reports the example as clean. The dev server is started by the Playwright
// config's webServer.

test.describe('module preview workbench', () => {
  test('renders the example draft inside the sandbox iframe', async ({ page }) => {
    await page.goto('/preview.html');

    // The example draft appears in the draft list.
    await expect(page.getByRole('button', { name: /预览示例/ })).toBeVisible();

    // Its content renders inside the sandboxed iframe.
    const frame = page.frameLocator('iframe.preview-sandbox__frame');
    await expect(frame.getByText('预览示例')).toBeVisible();
    await expect(frame.getByText(/今天：\d{4}-\d{2}-\d{2}/)).toBeVisible();
  });

  test('lint panel reports the clean example as passing', async ({ page }) => {
    await page.goto('/preview.html');
    await expect(page.getByRole('heading', { name: /校验：通过/ })).toBeVisible();
  });

  test('the size switcher changes the previewed frame dimensions', async ({ page }) => {
    await page.goto('/preview.html');

    const frame = page.locator('iframe.preview-sandbox__frame');
    await expect(frame).toBeVisible();
    const before = await frame.boundingBox();

    // Switch to the largest gear; the frame must grow.
    await page.getByRole('button', { name: '12×8' }).click();
    const after = await frame.boundingBox();

    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(after!.width).toBeGreaterThan(before!.width);
    expect(after!.height).toBeGreaterThan(before!.height);
  });
});
