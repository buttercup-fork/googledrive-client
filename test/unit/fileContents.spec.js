import sinon from "sinon";
import { expect } from "chai";
import { Layerr } from "layerr";
import { Headers } from "fetch-headers";
import { GoogleDriveClient } from "../../dist/index.js";

const FAKE_TOKEN = "aaaaabbbbbbccccccddddddeeeeee";

describe("fileContents", function () {
    describe("deleteFile", function () {
        beforeEach(function () {
            this.requestSpy = sinon.stub().returns(
                Promise.resolve({
                    ok: true,
                    text: () => Promise.resolve(""),
                    status: 200,
                    statusText: "OK"
                })
            );
            this.client = new GoogleDriveClient(FAKE_TOKEN);
            this.client.patcher.patch("request", this.requestSpy);
        });

        it("uses correct HTTP method", function () {
            return this.client.deleteFile("xxx").then(() => {
                const reqParams = this.requestSpy.firstCall.args[0];
                expect(reqParams).to.have.property("method", "DELETE");
            });
        });

        it("passes correct file ID", function () {
            return this.client.deleteFile("xx3x").then(() => {
                const reqParams = this.requestSpy.firstCall.args[0];
                expect(reqParams)
                    .to.have.property("url")
                    .to.match(/\/xx3x$/);
            });
        });
    });

    describe("getFileContents", function () {
        beforeEach(function () {
            this.requestSpy = sinon.stub().returns(
                Promise.resolve({
                    text: () => Promise.resolve("test\ncontents"),
                    ok: true,
                    status: 200,
                    statusText: "OK"
                })
            );
            this.client = new GoogleDriveClient(FAKE_TOKEN);
            this.client.patcher.patch("request", this.requestSpy);
        });

        it("returns expected data", function () {
            return this.client.getFileContents("abc").then(res => {
                expect(res).to.equal("test\ncontents");
            });
        });

        [
            [
                "no error quotes",
                {
                    "www-authenticate": `Bearer realm="https://accounts.google.com/", error=invalid_token`
                }
            ],
            [
                "error quotes",
                {
                    "www-authenticate": `Bearer realm="https://accounts.google.com/", error="invalid_token"`
                }
            ]
        ].forEach(([type, headers]) => {
            it(`includes auth flag if error failed due to authorization (${type})`, function () {
                this.requestSpy = sinon.stub().returns(
                    Promise.resolve({
                        text: () =>
                            Promise.resolve(
                                JSON.stringify({
                                    error: {
                                        errors: [
                                            {
                                                domain: "global",
                                                reason: "authError",
                                                message: "Invalid Credentials",
                                                locationType: "header",
                                                location: "Authorization"
                                            }
                                        ],
                                        code: 401,
                                        message: "Invalid Credentials"
                                    }
                                })
                            ),
                        ok: false,
                        headers: new Headers(headers),
                        status: 401,
                        statusText: "Unauthorized"
                    })
                );
                this.client.patcher.patch("request", this.requestSpy);
                return this.client
                    .getFileContents("abc")
                    .then(res => {
                        throw new Error("Request should have failed");
                    })
                    .catch(err => {
                        const info = Layerr.info(err);
                        expect(info).to.have.property("authFailure", true);
                    });
            });
        });
    });

    describe("putFileContents", function () {
        beforeEach(function () {
            this.requestSpy = sinon.stub().returns(
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ id: "new-id" }),
                    status: 200,
                    statusText: "OK"
                })
            );
            this.client = new GoogleDriveClient(FAKE_TOKEN);
            this.client.patcher.patch("request", this.requestSpy);
            this.getBody = () =>
                Buffer.from(this.requestSpy.firstCall.args[0].body).toString("utf8");
        });

        it("returns the file ID", function () {
            return this.client.putFileContents("data", null, "vault.bcup").then(id => {
                expect(id).to.equal("new-id");
            });
        });

        it("keeps non-ASCII file names intact", function () {
            return this.client.putFileContents("data", null, "Mein Tresor ü 日本.bcup").then(() => {
                expect(this.getBody()).to.contain('"name":"Mein Tresor ü 日本.bcup"');
            });
        });

        it("sets Content-Length to the body's byte length", function () {
            return this.client.putFileContents("x".repeat(3000), null, "Tresor ü.bcup").then(() => {
                const { body, headers } = this.requestSpy.firstCall.args[0];
                expect(headers["Content-Length"]).to.equal(String(body.byteLength));
            });
        });

        it("sends the contents base64 encoded", function () {
            return this.client.putFileContents("héllo vault", "abc").then(() => {
                const encoded = Buffer.from("héllo vault", "utf8").toString("base64");
                expect(this.getBody()).to.contain(encoded);
            });
        });

        it("updates an existing file by ID", function () {
            return this.client.putFileContents("data", "abc").then(() => {
                const { method, url } = this.requestSpy.firstCall.args[0];
                expect(method).to.equal("PATCH");
                expect(url).to.match(/\/files\/abc$/);
            });
        });
    });
});
