# Vizrt MSE system architecture blog

This is a kind of rolling blog noting technical aspects of the [Vizrt Media Sequencer Engine](https://documentation.vizrt.com/viz-engine-guide/3.5/general_requirements_media_sequencer.html) architecture from the perspective of a developer experiencing this technology stack for the first time. The content here is exploratory, probably inaccurate in some aspects and provided at the start of a journey. At some point it will stop being updated as this library matures through design, development and testing.

## Basics

### Media Sequencer Engine

The root of documentation for the MSE is available at:

    http://mse-host.address.or.ip:8580/

MSE is used as a central software component for coordinating the execution of media elements, controlled from Vizrt products including Trio, Pilot and Mosart. Elements are defined in a VDOM tree to a schedule and executed by a sequencer.

The detailed manual for the MSE is available at any running instance from:

    http://mse-host.address.or.ip:8580/mse_manual.html

A concern in terms of integration with another automation systems with its own scheduler and state management is that the MSE is also its own scheduler and holds state. Care will have to be taken to ensure that a shared view of _current state_ is maintained across software components with similar purposes, e.g. to avoid race conditions. An automation systems may need to be aware that it is not the only client application that might be working MSE data structures at the same time.

#### Actors

Actors are implemented as DLL plugins to the MSE. They can read and process the contents of the MSE tree structure, interpreting what they find to take actions according to the defined schedule. An actor can also modify the tree and receive updates about third party actors making changes to the tree.

The actions of the MSE are configured by _handlers_ defined in the scheduler sub-tree, e.g.:

    /scheduler/http_server

This allows the port used to configure the REST API and other HTML resources provided by the MSE _HTTP server_ actor to be configured. Similarly for other protocols.

Each Viz Engine controlled by the MSE has a handler.   

#### Filters and iterators

Filters process parts of the VDOM tree, selecting elements of interest to another handler or converting them to text, for example to create a log message entry.

Iterators allow other handlers to walk parts of a sub-tree or specify an iterative loop.

### Virtual Document Object Model

![VDOM config example](vdom.png)

See the [terminology page](./terminology.md) for more information.

To see and edit the VDOM tree, use the _VDOM config web app_ available at the following location:

    http://mse-host.address.or.ip:8580/app/vdomconfig/vdomconfig.html

This connects over websockets and uses the PepTalk protocol.

### Viz Data Format (VDF)

This is the underlaying means of describing the content that an element is filled-in with. An element has a VDF payload.

A (apparently future?) project to provide a standard way to represent the editing of data elements. Basically, a _VDF payload document_ is data in the form of a set of name/value _fields_ where the expected fields are defined by a _VDF model document_.

No evidence of this format has been found in examples so far.

### Four layer element model

Part of the REST API documentation only, a four-layer model is referred to:

1. **element** - can have different _fill-in_ data, _concepts_ and _variants_
2. **element model** - describes each of the fields to be filled in
3. **master template** - description of all possible layers, concepts and variants for an element, possibly with scene selectors
4. **scene info** - how to apply data to one particularly scene

The model can be considered as having just three layers as the element model is really just part of the template.

The details of how all these layers are applied in practices will be explored along with real examples.  

## Protocols

### REST API

The REST API provides a way read and manipulate the VDOM tree and execute commands. It is based on the XML-namespace-heavy [Atom Syndication Format (RFC4287 - 2005)](https://tools.ietf.org/html/rfc4287) and [Atom Publishing Protocol (_AtomPub_, RFC5023 - 2007)](https://tools.ietf.org/html/rfc5023) specifications, a pre-Twitter / Facebook way to publish and edit information feeds - with equivalent functionality to [RSS](https://en.wikipedia.org/wiki/RSS). As such, to anyone who has worked with JSON / REST and APIs like those used to work with cloud services, this approach is complex. It is also difficult to relate examples in the documentation to useful activity in a workflow.

The documentation for the MSE REST API is available at:

    http://mse-host.address.or.ip:8580/doc/

Analysis of traffic between the MSE and Mosart or Trio did not show any use of the REST API. In terms of a system _eating its own dog food_, it is not clear that this is interface is a preferred way to inspect and modify the VDOM tree. However, it does seem to provide a reasonable mechanism to execute commands.

### TreeTalk

Declared as _deprecated_ at the top level of the documentation, _TreeTalk_ is a way of manipulating the VDOM tree. It involves a strange mix of partial XML-like paths and pointer-like hex references to child elements and siblings within the VDOM tree. This makes it difficult to read and really requires a computer programme to make it useable.

TreeTalk is an MSE actor and documented in the MSE manual. It is based on a text-based line-by-line request/response pattern called _PlainTalk_. Each line is terminated with `\r\n`. Sequences of binary data or text data containing whitespace is proceeded by `{n}`, where `n` is the number of characters in the following field.

Wireshark shows that a few command-like messages between Mosart and MSE are still using TreeTalk. On opening a socket connection, TreeTalk is selected with the `protocol` command as the first message, e.g.:

    1 protocol treetalk

TreeTalk can be reached by Telnet on port `8594` or as a websocket on port `8595`. Once a connection is made, all operations that change the VDOM tree are reported via the socket. To suppress this, add `noevents` to the protocol commands.

In experiments, data structures in the VDOM were explored using TreeTalk. This was a time consuming process with lots of taking notes to keep track of pointer references within the tree.

### PepTalk

_PepTalk_ is a replacement for TreeTalk whereby the VDOM tree and subtrees can be serialized and manipulated (inserted, replaced, deleted, edited) as XML fragments. Wireshark shows traffic between Trio, Mosart and the VDOM config web app is using PepTalk.

On opening a socket connection, PepTalk is selected with the `protocol` command as the first message, e.g.:

    1 protocol peptalk

Like TreeTalk, PepTalk can be reached by Telnet on port `8594` or as a websocket on port `8595`. Once a connection is made, all operations that change the VDOM tree are reported via the socket. To suppress this, add `noevents` to the protocol commands.

In experiments, it was possible to query and alter the VDOM tree using PepTalk over websockets. This seems to be a good approach to editing the data within elements and other operations in the VDOM tree. It may also be a good way to spot changes being made to the tree by third party applications as these are reported as events.

### STOMP

The documentation claims that MSE supports the [Simple Text Oriented Messaging Protocol (STOMP)](https://stomp.github.io/). STOMP is a protocol for asynchronous communication with message brokers, such as [JMS](https://en.wikipedia.org/wiki/Java_Message_Service) queues, ideal for use with scripting languages. Javascript support is limited to the [stomp.js](http://jmesnil.net/stomp-websocket/doc/) STOMP-over-websockets library.

### Ports

| Port | Description                           |
| ---- | ------------------------------------- |
| 8580 | REST API, documentation and web apps. |
| 8581 | STOMP                                 |
| 8582 | Channel state websocket               |
| 8594 | TreeTalk and PepTalk plain sockets    |
| 8595 | TreeTalk and PepTalk websockets       |
| 8596 | Stacktrace server port                |

## Proposed approach

### Prototyping

A simple Node.js application has been written ([`cli_bund.js`](../src/scratch/cli_bund.js)) that allows interaction with the an MSE to change the text of a lower third overlay, _take-in_ the graphic, wait ten seconds and _take-out_ the graphic. This will be the basis of ongoing development, using the following modules:

* [`ws`](https://www.npmjs.com/package/ws) to connect to the MSE over webscockets with PepTalk for reading and writing data and monitoring events.
* [`request-promise-native`](https://www.npmjs.com/package/request-promise-native) to POST commands to the REST interface of the MSE.

So as to work with the XML structures in a Javascript-like format, the following library will be used:

* [`xml2js`](https://www.npmjs.com/package/xml2js) to convert XML to Javascript Objects and to programmatically build XML elements for sending to the MSE. Using this module, it should be difficult to generate syntactically-bad XML.

The structure of this prototype will be used as the basis of ongoing development.