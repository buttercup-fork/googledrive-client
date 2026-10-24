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
});
