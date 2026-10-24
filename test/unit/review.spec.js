import sinon from "sinon";
import { expect } from "chai";
import { Layerr } from "layerr";
import { GoogleDriveClient } from "../../dist/index.js";

const TOKEN = "aaaaabbbbbbccccccddddddeeeeee";

async function captureError(callback) {
    try {
        await callback();
    } catch (err) {
        return err;
    }
    return null;
}

function okResponse(body = {}) {
    return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => null },
        json: async () => body,
        text: async () => ""
    };
}

describe("Review fixes", function () {
    describe("B-636: file IDs are encoded in the URL path", function () {
        beforeEach(function () {
            this.request = sinon.stub().callsFake(async () => okResponse({ id: "new" }));
            this.client = new GoogleDriveClient(TOKEN);
            this.client.patcher.patch("request", this.request);
        });

        [
            ["deleteFile", (client, id) => client.deleteFile(id), "/drive/v3/files/"],
            ["getFileContents", (client, id) => client.getFileContents(id), "/drive/v3/files/"],
            [
                "putFileContents (update)",
                (client, id) => client.putFileContents("data", id),
                "/upload/drive/v3/files/"
            ]
        ].forEach(([method, call, prefix]) => {
            describe(method, function () {
                it("keeps a path in the ID inside one segment", async function () {
                    await call(this.client, "x/../trash");
                    const { url } = this.request.firstCall.args[0];
                    expect(url).to.equal(`https://www.googleapis.com${prefix}x%2F..%2Ftrash`);
                    // The parser fetch uses does not resolve it to another path
                    expect(new URL(url).pathname).to.equal(`${prefix}x%2F..%2Ftrash`);
                });

                it("keeps ? and # out of the query and fragment", async function () {
                    await call(this.client, "a?alt=x#y");
                    const { url } = this.request.firstCall.args[0];
                    expect(new URL(url).pathname).to.equal(`${prefix}a%3Falt%3Dx%23y`);
                    expect(new URL(url).search).to.equal("");
                });

                // putFileContents treats an empty ID as "create a new file"
                (method.startsWith("putFileContents") ? [".", ".."] : ["", ".", ".."]).forEach(
                    id => {
                        it(`refuses the ID ${JSON.stringify(id)} without a request`, async function () {
                            const error = await captureError(() => call(this.client, id));
                            expect(error).to.be.an.instanceOf(Error);
                            expect(Layerr.info(error)).to.have.property(
                                "code",
                                "ERR_INVALID_FILE_ID"
                            );
                            expect(this.request.callCount).to.equal(0);
                        });
                    }
                );

                it("leaves a normal ID unchanged", async function () {
                    await call(this.client, "1AbC-d_E2");
                    const { url } = this.request.firstCall.args[0];
                    expect(url).to.equal(`https://www.googleapis.com${prefix}1AbC-d_E2`);
                });
            });
        });
    });

    describe("B-637: listing leaves trashed items out on the server", function () {
        it("asks for untrashed items only", async function () {
            const request = sinon.stub().callsFake(async () =>
                okResponse({
                    files: [
                        { id: "a", name: "a.bcup", mimeType: "text/plain", parents: ["root"] },
                        {
                            id: "b",
                            name: "b.bcup",
                            mimeType: "text/plain",
                            parents: ["root"],
                            trashed: true
                        }
                    ]
                })
            );
            const client = new GoogleDriveClient(TOKEN);
            client.patcher.patch("request", request);
            const files = await client.getDirectoryContents(false);
            expect(request.firstCall.args[0].query).to.have.property("q", "trashed = false");
            // The client-side filter stays as a backstop
            expect(files.map(file => file.id)).to.deep.equal(["a"]);
        });
    });

    describe("B-638: requests time out", function () {
        beforeEach(function () {
            this.originalFetch = globalThis.fetch;
            this.calls = [];
            // A server that never answers: the promise only ends on abort
            globalThis.fetch = (url, options = {}) =>
                new Promise((resolve, reject) => {
                    this.calls.push({ url, options });
                    if (options.signal) {
                        options.signal.addEventListener("abort", () =>
                            reject(new Error("aborted"))
                        );
                    }
                });
        });

        afterEach(function () {
            globalThis.fetch = this.originalFetch;
        });

        it("aborts a listing after `timeout`", async function () {
            const client = new GoogleDriveClient(TOKEN, { timeout: 20, contentTimeout: 60000 });
            const started = Date.now();
            const error = await captureError(() => client.getDirectoryContents(false));
            expect(error).to.be.an.instanceOf(Error);
            expect(error.message).to.match(/aborted/);
            expect(Date.now() - started).to.be.below(2000);
        });

        it("aborts a download after `contentTimeout`", async function () {
            const client = new GoogleDriveClient(TOKEN, { timeout: 60000, contentTimeout: 20 });
            const error = await captureError(() => client.getFileContents("abc"));
            expect(error).to.be.an.instanceOf(Error);
            expect(error.message).to.match(/aborted/);
        });

        it("aborts an upload after `contentTimeout`", async function () {
            const client = new GoogleDriveClient(TOKEN, { timeout: 60000, contentTimeout: 20 });
            const error = await captureError(() => client.putFileContents("data", "abc"));
            expect(error).to.be.an.instanceOf(Error);
            expect(error.message).to.match(/aborted/);
        });

        [
            [
                "attachment download",
                {
                    url: "https://www.googleapis.com/drive/v3/files/abc",
                    query: { alt: "media", supportsAllDrives: "true" }
                }
            ],
            [
                "attachment upload",
                {
                    url: "https://www.googleapis.com/upload/drive/v3/files/abc",
                    query: { uploadType: "media", supportsAllDrives: "true" }
                }
            ]
        ].forEach(([name, partial]) => {
            it(`applies the content limit to core's ${name} through the patcher`, async function () {
                const client = new GoogleDriveClient(TOKEN, { timeout: 60000, contentTimeout: 20 });
                const error = await captureError(() =>
                    client.patcher.execute("request", { method: "GET", headers: {}, ...partial })
                );
                expect(error).to.be.an.instanceOf(Error);
                expect(error.message).to.match(/aborted/);
            });
        });

        it("defaults to 60 seconds for metadata and 10 minutes for content", async function () {
            const clock = sinon.useFakeTimers();
            try {
                const client = new GoogleDriveClient(TOKEN);
                const listing = captureError(() => client.getDirectoryContents(false));
                const download = captureError(() => client.getFileContents("abc"));
                await clock.tickAsync(0);
                expect(this.calls).to.have.lengthOf(2);
                const [listingSignal, downloadSignal] = this.calls.map(call => call.options.signal);
                expect(listingSignal).to.be.an.instanceOf(AbortSignal);
                expect(downloadSignal).to.be.an.instanceOf(AbortSignal);
                await clock.tickAsync(59999);
                expect(listingSignal.aborted).to.equal(false);
                await clock.tickAsync(1);
                expect(listingSignal.aborted).to.equal(true);
                expect((await listing).message).to.match(/aborted/);
                await clock.tickAsync(10 * 60 * 1000 - 60000 - 1);
                expect(downloadSignal.aborted).to.equal(false);
                await clock.tickAsync(1);
                expect(downloadSignal.aborted).to.equal(true);
                expect((await download).message).to.match(/aborted/);
            } finally {
                clock.restore();
            }
        });

        it("sends no signal when both limits are 0", async function () {
            const client = new GoogleDriveClient(TOKEN, { timeout: 0, contentTimeout: 0 });
            client.getDirectoryContents(false).catch(() => {});
            client.getFileContents("abc").catch(() => {});
            await new Promise(resolve => setTimeout(resolve, 10));
            expect(this.calls).to.have.lengthOf(2);
            this.calls.forEach(call => expect(call.options.signal).to.equal(undefined));
        });

        it("clears the timer once the response arrives", async function () {
            globalThis.fetch = async (url, options) => {
                this.calls.push({ url, options });
                return okResponse({ files: [] });
            };
            const client = new GoogleDriveClient(TOKEN, { timeout: 20 });
            await client.getDirectoryContents(false);
            await new Promise(resolve => setTimeout(resolve, 60));
            expect(this.calls[0].options.signal.aborted).to.equal(false);
        });
    });
});
