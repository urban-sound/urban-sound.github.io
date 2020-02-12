// all of this is bit old-fashion
// but looks like mobile browsers
// can't understand some new JS features

if (window.UrbanSound == null) {
    window.UrbanSound = {};
}

(function ($) {

    function mediaController(options) {

        //#region setup        

        var audioContext = null;
        var mediaStreamSourceNode = null;
        var scriptProcessorNode = null;
        var gainNode = null;
        var analyzerNode = null;
        var fftBins = null;

        var instance = {
        };

        var settings;
        var defaultSettings = {
            bufferSize: 512,
            channels: 1,
            sampleRate: 44100,
            smoothing: 0.1,
            recordOptions: { mimeType: 'audio/webm' },
            errorHandler: function (error) {
                alert(error);
            }
        };

        //#endregion

        //#region classes

        var random = {
            _rnd: null,
            set: function (num) {
                this._rnd = num;
            },
            get(min, max) {
                var rnd = this._rnd || Math.random();
                return rnd * (max - min) + min;
            },
            getInt(min, max) {
                var rnd = this._rnd || Math.random();
                min = Math.ceil(min);
                max = Math.floor(max);
                return Math.floor(rnd * (max - min + 1)) + min;
            },
            getBool() {
                var int = this.getInt(0, 1);
                return int === 1;
            },
            getSign() {
                return this.getBool() ? 1 : -1;
            }
        };

        var volumeController = {
            threshHold: 10,
            workInterval: 0.5,
            measureInterval: 30,
            frames: 0,
            current: 0,
            sum: 0,
            start: function () {
                var handler = this.work.bind(this);
                setInterval(handler, this.workInterval * 1000)
            },
            work: function () {
                this.current = getMaxVolume();
                if (this.frames++ > this.measureInterval) {
                    this.frames = 1;
                    this.sum = 0;
                    return;
                }
                this.sum += this.current;
            },
            isSomethingInterestingHappening: function () {
                if (this.current > 0 && this.frames > 0) {
                    var median = this.sum / this.frames;
                    return this.current - median > this.threshHold;
                }
                return false;
            }
        };

        var recordController = {
            workInterval: 1,
            recordIntervalMin: 10,
            recordIntervalMax: 30,
            isRecording: false,
            recordedChunks: [],
            recordLength: 0,
            startTime: null,
            stopTime: null,
            blobs: new fixedQueue(5),
            start: function () {
                var handler = this.work.bind(this);
                setInterval(handler, this.workInterval * 1000)
            },
            work: function () {
                if (this.shouldStart()) {
                    this.record();
                } else if (recordController.shouldStop()) {
                    this.stop();
                }
            },
            // determine whether to start record
            shouldStart: function () {
                if (this.isRecording) return false; // is recording now
                if (this.blobs.isFull()) {
                    console.log('queue is full');
                    return false;
                }
                if (this.stopTime == null) return true; // not recorded yet
                var now = this.getTimestamp();
                if (now - this.stopTime >= this.recordIntervalMax) return true; // should record after interval
                if (now - this.stopTime >= this.recordIntervalMin &&
                    volumeController.isSomethingInterestingHappening()) return true; // record if something happens
                return false;
            },
            record: function () {
                this.recordLength = random.getInt(3, 8);
                this.startTime = this.getTimestamp();
                this.recordedChunks = [];
                this.isRecording = true;
                console.log(`Started recording of ${this.recordLength} seconds`);
            },
            // determine whether to stop record
            shouldStop: function () {
                if (!this.isRecording) return false; // nothing to stop
                var now = this.getTimestamp();
                if (now - this.startTime >= this.recordLength) return true; // recorded required length
                return false;
            },
            stop: function () {
                this.stopTime = this.getTimestamp();
                this.isRecording = false;
                console.log(`Finished recording of ${this.recordLength} seconds`);
                this.onStop();
            },
            onStop: function () {
                var dataview = encodeWAV(this.recordedChunks);
                var blob = new Blob([dataview], { 'type': 'audio/wav' });
                this.blobs.enqueue(blob);
            },
            getTimestamp: function () {
                return new Date().getTime() / 1000;
            }
        };

        var effectController = {
            effects: [],
            workInterval: 1,
            wipeOutInterval: 300,
            minInterval: 5,
            maxInterval: 20,
            start: function () {
                this.effects = [new SpeedRater(), new Reverser(), new Rater()];
                var workHandler = this.work.bind(this);
                setInterval(workHandler, this.workInterval * 1000)
                var wipeHandler = this.wipeout.bind(this);
                setInterval(wipeHandler, this.wipeOutInterval * 1000)
            },
            work: function () {
                var isAllEffectsWorking = this.effects.every(e => e.isWorking());
                if (!isAllEffectsWorking && this.timer == null) {
                    // schedule next effect
                    var interval = random.getInt(this.minInterval, this.maxInterval);
                    var handler = this.startEffect.bind(this);
                    console.log(`scheduling next effect in ${interval} s`)
                    this.timer = setTimeout(handler, interval * 1000);
                }
            },
            startEffect: function () {
                this.timer = null;
                var notWorking = this.effects.filter(e => !e.isWorking());
                if (notWorking.length > 0) {
                    var index = random.getInt(0, notWorking.length - 1);
                    console.log(`running scheduled effect ${index}`)
                    notWorking[index].apply();
                } else {
                    console.log('all effects working')
                }
            },
            wipeout: function () {
                // cleanup effects every 5 mins
                console.log('wipe out all')
                for (var i = 0; i < this.effects.length; ++i) {
                    this.effects[i].stop();
                }
            }
        };


        function fixedQueue(max) {

            var data = [];

            function enqueue(obj) {
                if (data.length >= max) return;
                data.push(obj);
            }

            function dequeue() {
                if (data.length > 0) {
                    return data.splice(0, 1)[0];
                }
                return null;
            }

            function isFull() {
                return data.length >= max;
            }

            var instance = {
                enqueue: enqueue,
                dequeue: dequeue,
                isFull: isFull
            };
            return instance;

        }

        //#endregion

        //#region effects

        function baseEffect() { };
        baseEffect.prototype.name = null;
        baseEffect.prototype.sourceNodes = null;
        baseEffect.prototype.duration = 0; // effect duration seconds
        baseEffect.prototype.isWorking = function () {
            return this.sourceNodes != null;
        };
        baseEffect.prototype.onAudioReady = function (audioBuffer) {
            console.log('baseEffect onAudioReady')
        };
        baseEffect.prototype.apply = function () {
            if (this.isWorking()) return; // already working            
            var blob = recordController.blobs.dequeue();
            if (blob != null) {
                this.sourceNodes = [];
                getAudioBufferFromBlob(blob, this.onAudioReady.bind(this));
            }
        };
        baseEffect.prototype.stop = function () {
            if (this.sourceNodes != null) {
                for (var i = 0; i < this.sourceNodes.length; ++i) {
                    if (this.sourceNodes[i] != null) {
                        this.sourceNodes[i].stop();
                        this.sourceNodes[i].disconnect();
                        this.sourceNodes[i] = null;
                    }
                }
                this.sourceNodes = null;
            }
        };
        baseEffect.prototype.onStop = function () {
            console.log(`finished ${this.name} effect after ${this.duration} s`);
            this.stop();
        };
        baseEffect.prototype.scheduleStop = function () {
            var handler = this.onStop.bind(this);
            setTimeout(handler, this.duration * 1000);
        }

        function Reverser() { }
        Reverser.prototype = new baseEffect();
        Reverser.prototype.name = "reverser";
        Reverser.prototype.onAudioReady = function (audioBuffer) {
            this.duration = random.get(audioBuffer.duration / 2, audioBuffer.duration * 5);
            console.log(`starting ${this.name} effect for ${this.duration} s`);
            var sourceNode = audioContext.createBufferSource();
            for (var i = 0; i < settings.channels; ++i) {
                var data = audioBuffer.getChannelData(i);
                data.reverse();
            }
            sourceNode.buffer = audioBuffer;
            sourceNode.loop = true;
            sourceNode.connect(gainNode);
            sourceNode.start();
            this.sourceNodes.push(sourceNode);
            this.scheduleStop();
        };

        function Rater() { }
        Rater.prototype = new baseEffect();
        Rater.prototype.name = "rater";
        Rater.prototype.onAudioReady = function (audioBuffer) {
            this.rate = random.get(0.5, 10);
            this.duration = (this.rate > 1 ? audioBuffer.duration * (this.rate) : audioBuffer.duration / this.rate);
            console.log(`starting ${this.name} effect for ${this.duration} s, rate: ${this.rate}, audio duration: ${audioBuffer.duration}`);
            var sourceNode = audioContext.createBufferSource();
            sourceNode.buffer = audioBuffer;
            sourceNode.loop = true;
            sourceNode.playbackRate.linearRampToValueAtTime(this.rate, audioContext.currentTime + this.duration);
            sourceNode.connect(gainNode);
            sourceNode.start();
            this.sourceNodes.push(sourceNode);
            this.scheduleStop();
        };

        function SpeedRater() { }
        SpeedRater.prototype = new baseEffect();
        SpeedRater.prototype.name = "speed rater";
        SpeedRater.prototype.onAudioReady = function (audioBuffer) {
            this.rate = random.getInt(5, 25);
            var frames = random.getInt(10, 20)
            this.duration = audioBuffer.duration / this.rate * frames;
            console.log(`starting ${this.name} effect for ${this.duration} s, rate: ${this.rate}, audio duration: ${audioBuffer.duration}`);
            var sourceNode = audioContext.createBufferSource();
            sourceNode.buffer = audioBuffer;
            sourceNode.loop = true;
            sourceNode.playbackRate.value = this.rate;
            sourceNode.connect(gainNode);
            sourceNode.start();
            this.sourceNodes.push(sourceNode);
            this.scheduleStop();
        };

        //#endregion

        //#region UI interaction

        function uiHandler(evt) {
            if (audioContext == null) {
                start();
            } else {
                var muted = $(settings.controls.button).prop('muted');
                toggleMute(muted);
            }
        }

        function toggleMute(muted) {
            gainNode.gain.setTargetAtTime(muted ? 0 : 1, audioContext.currentTime, 1);
            $(settings.controls.button).prop('muted', !muted).text(muted ? 'старт' : 'стоп');
        }

        //#endregion

        //#region media permissions

        function getAudioContext() {
            var AudioContext = window.AudioContext // Default
                || window.webkitAudioContext // Safari and old versions of Chrome
                || false;
            return new AudioContext;
        }

        function initUserMedia() {

            // Older browsers might not implement mediaDevices at all, so we set an empty object first
            if (navigator.mediaDevices === undefined) {
                navigator.mediaDevices = {};
            }

            // Some browsers partially implement mediaDevices. We can't just assign an object
            // with getUserMedia as it would overwrite existing properties.
            // Here, we will just add the getUserMedia property if it's missing.
            if (navigator.mediaDevices.getUserMedia === undefined) {
                navigator.mediaDevices.getUserMedia = function (constraints) {

                    // First get ahold of the legacy getUserMedia, if present
                    var getUserMedia = navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;

                    // Some browsers just don't implement it - return a rejected promise with an error
                    // to keep a consistent interface
                    if (!getUserMedia) {
                        return Promise.reject(new Error('getUserMedia is not implemented in this browser'));
                    }

                    // Otherwise, wrap the call to the old navigator.getUserMedia with a Promise
                    return new Promise(function (resolve, reject) {
                        getUserMedia.call(navigator, constraints, resolve, reject);
                    });
                }
            }
        }

        function askPermissions() {
            navigator.mediaDevices.getUserMedia({ audio: true, video: false })
                .then(stream => {
                    startAudio(stream);
                })
                .catch(error => {
                    settings.errorHandler(error);
                });
        }

        //#endregion

        function startAudio(stream) {
            audioContext = getAudioContext();
            mediaStreamSourceNode = audioContext.createMediaStreamSource(stream);
            scriptProcessorNode = audioContext.createScriptProcessor(settings.bufferSize, settings.channels, settings.channels);
            gainNode = audioContext.createGain();

            analyzerNode = audioContext.createAnalyser();
            analyzerNode.fftSize = settings.bufferSize;
            analyzerNode.smoothingTimeConstant = settings.smoothing;
            fftBins = new Float32Array(analyzerNode.frequencyBinCount);

            mediaStreamSourceNode.connect(analyzerNode);
            analyzerNode.connect(scriptProcessorNode);
            scriptProcessorNode.connect(gainNode);
            gainNode.connect(audioContext.destination);
            scriptProcessorNode.onaudioprocess = onAudioProcess;

            toggleMute(false);

            volumeController.start();
            recordController.start();
            effectController.start();
        }

        function onAudioProcess(audioProcessingEvent) {
            // The input buffer is the song we loaded earlier
            var inputBuffer = audioProcessingEvent.inputBuffer;

            // The output buffer contains the samples that will be modified and played
            var outputBuffer = audioProcessingEvent.outputBuffer;

            var sum = 0;

            // Loop through the output channels (in this case there is only one)
            for (var channel = 0; channel < outputBuffer.numberOfChannels; channel++) {
                var inputData = inputBuffer.getChannelData(channel);
                var outputData = outputBuffer.getChannelData(channel);

                // Loop through the samples
                for (var sample = 0; sample < inputBuffer.length; sample++) {
                    // make output equal to the same as the input
                    outputData[sample] = inputData[sample];
                    if (recordController.isRecording) {
                        recordController.recordedChunks.push(inputData[sample])
                    }
                    sum += Math.abs(inputData[sample]);
                }
            }

            var eventDrivenRandomNumber = sum;
            if (eventDrivenRandomNumber > 1) {
                eventDrivenRandomNumber = eventDrivenRandomNumber / Math.pow(10, parseInt(eventDrivenRandomNumber).toString().length);
            }
            if (eventDrivenRandomNumber > 0) {
                random.set(eventDrivenRandomNumber);
            }

            return true;
        }

        function getMaxVolume() {
            var maxVolume = -Infinity;
            analyzerNode.getFloatFrequencyData(fftBins);

            for (var i = 4, ii = fftBins.length; i < ii; i++) {
                if (fftBins[i] > maxVolume && fftBins[i] < 0) {
                    maxVolume = fftBins[i];
                }
            };

            return Math.abs(maxVolume);
        }

        function getAudioBufferFromBlob(blob, onSuccess) {
            let fileReader = new FileReader();
            fileReader.readAsArrayBuffer(blob);
            fileReader.onload = function () {
                let arrayBuffer = fileReader.result;
                audioContext.decodeAudioData(arrayBuffer, onSuccess, settings.errorHandler);
            };
        }

        //#region Utility functions from https://github.com/mattdiamond/Recorderjs/blob/master/src/recorder.js
        function encodeWAV(samples) {

            var buffer = new ArrayBuffer(44 + samples.length * 2);

            var view = new DataView(buffer);

            /* RIFF identifier */

            writeString(view, 0, 'RIFF');

            /* RIFF chunk length */

            view.setUint32(4, 36 + samples.length * 2, true);

            /* RIFF type */

            writeString(view, 8, 'WAVE');

            /* format chunk identifier */

            writeString(view, 12, 'fmt ');

            /* format chunk length */

            view.setUint32(16, 16, true);

            /* sample format (raw) */

            view.setUint16(20, 1, true);

            /* channel count */

            view.setUint16(22, settings.channels, true);

            /* sample rate */

            view.setUint32(24, settings.sampleRate, true);

            /* byte rate (sample rate * block align) */

            view.setUint32(28, settings.sampleRate * 4, true);

            /* block align (channel count * bytes per sample) */

            view.setUint16(32, settings.channels * 2, true);

            /* bits per sample */

            view.setUint16(34, 16, true);

            /* data chunk identifier */

            writeString(view, 36, 'data');

            /* data chunk length */

            view.setUint32(40, samples.length * 2, true);

            floatTo16BitPCM(view, 44, samples);

            return view;

        }

        function writeString(view, offset, string) {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        }

        function floatTo16BitPCM(output, offset, input) {
            for (let i = 0; i < input.length; i++ , offset += 2) {
                let s = Math.max(-1, Math.min(1, input[i]));
                output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
            }
        }

        //#endregion

        function start() {
            initUserMedia();
            askPermissions();
        }

        function init() {
            settings = $.extend(true, defaultSettings, options || {});
            $(settings.controls.button).click(uiHandler);
            return instance;
        }

        return init();
    }

    $.extend(true, UrbanSound, { MediaController: mediaController });

})(jQuery);
